const { Worker } = require('bullmq');
const { getQueueConnectionOptions } = require('../config/queue');
const { generateTripPlan, generateDetailedPlan } = require('../services/gemini.service');
const fallback = require('../planning/fallbackPlanner');
const ragService = require('../services/rag.service');
const cacheService = require('../services/cache.service');
const Trip = require('../models/Trip.model');
const { logFailedJob } = require('../services/dlq.service');
const logger = require('../utils/logger');

const processor = async (job) => {
  const { type, userId } = job.data;
  logger.info(`[Itinerary Worker] Processing job ${job.id} - Type: ${type}`);

  if (type === 'trip') {
    const { tripId, tripData, thread_id } = job.data;
    const trip = await Trip.findById(tripId);
    if (!trip) {
      throw new Error(`Trip ${tripId} not found`);
    }

    // Fetch Copilot Chat History from LangGraph Checkpointer
    let chatHistory = [];
    if (thread_id) {
      const { getChatHistory } = require('../langgraph/checkpointer');
      chatHistory = await getChatHistory(thread_id);
    }

    // Build RAG Context to eliminate dummy data
    const days = Math.ceil((new Date(tripData.endDate) - new Date(tripData.startDate)) / (1000 * 60 * 60 * 24)) || 1;
    const input = {
      source: tripData.source,
      destination: tripData.destination,
      startDate: tripData.startDate,
      budget: tripData.budget,
      days: days
    };
    const contextPackage = await ragService.buildContextPackage(input);

    // Try Gemini first, fallback to deterministic engine
    let planData = await generateTripPlan(tripData, contextPackage, chatHistory);
    let usedFallback = false;

    if (!planData) {
      logger.warn(`⚠️ Gemini failed — using deterministic fallback for ${tripData.destination}`);
      planData = fallback.generatePlan(tripData);
      usedFallback = true;
    }

    const tags = [
      tripData.destination.toLowerCase(),
      ...(planData.meta?.tags || []),
      ...(tripData.preferences || []).slice(0, 3),
    ].filter(Boolean);

    trip.planData = planData;
    trip.tags = tags;
    trip.usedFallback = usedFallback;
    
    // Save to DB
    await trip.save();

    // Invalidate feed + trending caches
    cacheService.flushMany('destinations:feed', 'destinations:trending').catch((err) =>
      logger.warn(`[Cache] Feed/trending invalidation failed: ${err.message}`)
    );

    // Log trip_create activity for recommendation engine (fire-and-forget)
    try {
      const { logActivity } = require('../services/recommendation.service');
      await logActivity(userId, 'trip_create', null, null, {
        destination: tripData.destination,
        source: tripData.source,
        groupType: tripData.groupType || 'solo',
      });
    } catch (err) {
      logger.warn(`[Itinerary Worker] logActivity failed: ${err.message}`);
    }

    // Emit real-time notification to user via Socket.io
    const io = global.__io;
    const activeUsers = global.__activeUsers;
    if (io && activeUsers) {
      const socketId = activeUsers.get(userId.toString());
      if (socketId) {
        io.to(socketId).emit('itinerary:completed', {
          tripId,
          destination: tripData.destination,
          success: true,
          planData
        });
      }
    }

  } else if (type === 'plan') {
    const { input } = job.data;
    const cacheRaw = `${input.destination}|${input.budget}|${input.days}|${input.interests.join(',')}`;

    // Build RAG Context
    const contextPackage = await ragService.buildContextPackage(input);

    // Call Gemini AI
    let plan = await generateDetailedPlan(input, contextPackage);
    let usedFallback = false;

    if (!plan) {
      logger.warn(`⚠️ Gemini failed — using deterministic fallback for ${input.destination}`);
      plan = fallback.generateDetailedFallback(input);
      usedFallback = true;
    }

    const result = { plan, usedFallback, destination: input.destination, days: input.days, budget: input.budget };

    // Cache the generated plan
    if (!usedFallback) {
      try {
        await cacheService.set('itinerary', cacheRaw, result);
        logger.info(`[Cache] SET itinerary — ${input.destination}`);
      } catch (err) {
        logger.warn(`[Cache] Failed to store itinerary: ${err.message}`);
      }
    }

    // Emit real-time notification to user via Socket.io
    const io = global.__io;
    const activeUsers = global.__activeUsers;
    if (io && activeUsers) {
      const socketId = activeUsers.get(userId.toString());
      if (socketId) {
        io.to(socketId).emit('itinerary:plan:completed', {
          cacheRaw,
          destination: input.destination,
          success: true,
          result,
        });
      }
    }
  } else {
    throw new Error(`Unknown job type: ${type}`);
  }
};

const initWorker = () => {
  const connectionOpts = getQueueConnectionOptions();
  const worker = new Worker('itinerary', processor, {
    ...connectionOpts,
    concurrency: 2,
  });

  worker.on('completed', (job) => {
    logger.info(`[Itinerary Worker] Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[Itinerary Worker] Job ${job.id} failed: ${err.message}`);
    if (job) {
      logFailedJob('itinerary', job, err);

      // Emit failure event to client
      const { userId, type, tripId } = job.data;
      const io = global.__io;
      const activeUsers = global.__activeUsers;
      if (io && activeUsers) {
        const socketId = activeUsers.get(userId.toString());
        if (socketId) {
          io.to(socketId).emit('itinerary:failed', {
            tripId,
            type,
            error: err.message,
          });
        }
      }
    }
  });

  return worker;
};

module.exports = { initWorker };
