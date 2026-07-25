// src/langgraph/checkpointer.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 — MongoDB Checkpointing for LangGraph
//
// Connects the MongoDBSaver to the EXISTING Mongoose connection so no second
// MongoClient is opened.  The checkpointer gives LangGraph automatic
// multi-turn memory:  state is written to MongoDB after every node execution
// and reloaded at the start of each `graph.invoke` / `graph.streamEvents`
// call by matching the `thread_id` in the RunnableConfig.
//
// Usage:
//   const { getCheckpointer } = require('./langgraph/checkpointer')
//   const checkpointer = await getCheckpointer()
//   const graph = workflow.compile({ checkpointer })
//   await graph.invoke(state, { configurable: { thread_id: 'conv_<conversationId>' } })
//
// Dependency (add once):
//   npm install @langchain/langgraph-checkpoint-mongodb
// ─────────────────────────────────────────────────────────────────────────────

'use strict'

const mongoose = require('mongoose')
const { MongoDBSaver } = require('@langchain/langgraph-checkpoint-mongodb')
const logger = require('../utils/logger')

/** @type {import('@langchain/langgraph-checkpoint-mongodb').MongoDBSaver | null} */
let _checkpointer = null

/**
 * Returns (and lazily initialises) a MongoDBSaver that shares the live
 * Mongoose connection.
 *
 * ⚠️  Call this AFTER `connectDB()` has resolved — i.e. inside an async
 * startup block or the first time a request arrives.
 *
 * The returned saver is a singleton: every call after the first returns the
 * same instance so we don't keep opening duplicate database handles.
 *
 * @returns {Promise<import('@langchain/langgraph-checkpoint-mongodb').MongoDBSaver>}
 */
async function getCheckpointer() {
  if (_checkpointer) return _checkpointer

  const { connection } = mongoose

  if (connection.readyState !== 1 /* connected */) {
    throw new Error(
      '[Checkpointer] Mongoose is not connected. ' +
      'Ensure connectDB() has finished before calling getCheckpointer().'
    )
  }

  // MongoDBSaver accepts an already-open MongoClient via `connection.getClient()`
  // so it reuses the connection pool Mongoose manages.
  const client = connection.getClient()

  _checkpointer = new MongoDBSaver({
    client,
    // Store checkpoints in the same DB Mongoose is using.
    dbName: connection.db.databaseName,
    // Dedicated collection — won't interfere with app collections.
    checkpointCollectionName: 'lg_checkpoints',
    writeCollectionName:      'lg_checkpoint_writes',
  })

  logger.info(
    `[Checkpointer] MongoDBSaver ready — db: "${connection.db.databaseName}", ` +
    `collections: lg_checkpoints / lg_checkpoint_writes`
  )

  return _checkpointer
}

/**
 * Resets the singleton — useful in tests that need a clean state.
 */
function resetCheckpointer() {
  _checkpointer = null
}

/**
 * Extracts a simplified chat history array from the checkpointer for a given thread.
 * Returns an array of { role: 'user' | 'assistant', text: string }.
 */
async function getChatHistory(thread_id) {
  if (!thread_id) return []
  try {
    const cp = await getCheckpointer()
    const tuple = await cp.getTuple({ configurable: { thread_id } })
    if (!tuple?.checkpoint?.channel_values?.messages) return []

    const messages = tuple.checkpoint.channel_values.messages
    return messages.map(m => {
      // LangChain BaseMessage objects serialized to JSON usually have 'id' arrays containing the class name,
      // or a 'type' property (like 'human', 'ai').
      const isHuman = m.type === 'human' || (m.id && m.id.includes('HumanMessage'))
      const role = isHuman ? 'user' : 'assistant'
      const text = typeof m.content === 'string' ? m.content : (m.kwargs?.content || '')
      return { role, text }
    }).filter(m => m.text)
  } catch (err) {
    logger.warn(`[Checkpointer] Failed to fetch chat history for thread ${thread_id}: ${err.message}`)
    return []
  }
}

module.exports = { getCheckpointer, resetCheckpointer, getChatHistory }
