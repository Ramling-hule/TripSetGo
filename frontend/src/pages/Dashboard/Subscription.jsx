// src/pages/Dashboard/Subscription.jsx
// TripSetGo — Subscription Conversion Workspace
// Features premium billing cards, Razorpay secure order dialogs, daily usage trackers, benefits showcases, and FAQ accordions.
import { useEffect, useState, useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Check, Zap, Crown, HelpCircle, ChevronDown, ChevronUp,
  CreditCard, Shield, Clock, History, Loader2,
  CheckCircle2, AlertCircle, RefreshCw, Compass, Map, DollarSign, Sparkles, Download
} from 'lucide-react'
import {
  fetchSubscriptionStatus,
  fetchPlans,
  fetchPaymentHistory,
  createOrder,
  verifyPayment,
  selectSubscription,
  selectSubLoading,
  selectSubVerifying,
  clearError,
} from '@/features/subscription/subscriptionSlice'
import Badge from '@/components/common/Badge'

const PLANS_FALLBACK = [
  {
    id: 'free', name: 'Free', price: 0, period: 'forever',
    features: ['5 AI trip plans/day', 'Discover feed', 'Basic export', 'Group trips (up to 3)'],
  },
  {
    id: 'pro', name: 'Pro', price: 4900, period: 'month',  // price in paise = ₹49/month
    features: [
      'Unlimited AI trip plans',
      'Priority Gemini AI',
      'Mapbox route maps',
      'PDF/Excel export',
      'Unlimited group trips',
      'Early access features',
    ],
    highlight: true,
  },
]

const FAQS = [
  {
    q: 'How many trips can I plan with the Free plan?',
    a: 'The Free plan allows you to plan up to 5 AI-powered itineraries per day, which resets daily. You can also explore public community trips and collaborate with up to 3 group members.',
  },
  {
    q: 'Can I cancel my subscription at any time?',
    a: 'Yes, absolutely! There are no long-term contracts. You can cancel your subscription at any time directly from this portal, and you will maintain access to Pro features until the end of your billing cycle.',
  },
  {
    q: 'What premium features are included in Pro?',
    a: 'Pro tier unlocks unlimited AI trip planning, priority Gemini AI processing, interactive Mapbox route overlays, high-fidelity PDF/Excel data exports, unlimited group collaborators, and early access to all new dashboard updates.',
  },
  {
    q: 'Are payments secure?',
    a: 'Yes. All payments are processed secure by Razorpay — a PCI-DSS Level 1 certified payment gateway. We never store your card information on our servers.',
  },
  {
    q: 'What if my browser closed during payment?',
    a: 'No worries! Our system automatically receives a webhook from Razorpay confirming your payment. Your subscription will be activated within minutes even if your browser closed during checkout.',
  },
]

function PaymentOverlay ({ stage }) {
  const stages = {
    creating:  { icon: <Loader2 size={36} className="animate-spin text-indigo-400" />, text: 'Creating secure order…' },
    checkout:  { icon: <CreditCard size={36} className="text-indigo-400" />,           text: 'Opening payment window…' },
    verifying: { icon: <Shield size={36} className="text-indigo-400" />,               text: 'Verifying payment…' },
    success:   { icon: <CheckCircle2 size={36} className="text-emerald-400" />,        text: 'Payment successful! 🎉' },
    error:     { icon: <AlertCircle size={36} className="text-rose-400" />,            text: 'Payment failed' },
  }

  const { icon, text } = stages[stage] || stages.creating

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-surface-base/90 backdrop-blur-md gap-4"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="flex flex-col items-center gap-3.5"
      >
        {icon}
        <p className="text-sm font-bold text-text-primary">{text}</p>
        <p className="text-[10px] text-text-secondary">
          {stage === 'verifying' ? 'This takes just a moment' : 'Please do not close this window'}
        </p>
      </motion.div>
    </motion.div>
  )
}

function PaymentHistoryRow ({ payment }) {
  const statusColors = {
    captured: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/15',
    failed:   'text-rose-400 bg-rose-500/10 border-rose-500/15',
    pending:  'text-amber-400 bg-amber-500/10 border-amber-500/15',
    refunded: 'text-text-muted bg-surface-raised border-border/10',
  }

  return (
    <div className="flex justify-between items-center p-3.5 border-b border-border/10 text-xs gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={`w-2 h-2 rounded-full shrink-0 ${payment.status === 'captured' ? 'bg-emerald-500' : payment.status === 'failed' ? 'bg-rose-500' : 'bg-amber-500'}`} />
        <div className="min-w-0">
          <p className="font-bold text-text-primary truncate">
            {payment.planId === 'pro' ? 'Pro Plan — Monthly' : payment.planId}
          </p>
          <p className="text-[9px] text-text-muted mt-0.5 font-medium">
            {new Date(payment.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="font-extrabold text-text-primary">
          ₹{((payment.amount || 0) / 100).toFixed(0)}
        </p>
        <span className={`text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded border mt-0.5 inline-block ${statusColors[payment.status] || statusColors.pending}`}>
          {payment.status}
        </span>
      </div>
    </div>
  )
}

export default function Subscription () {
  const dispatch      = useDispatch()
  const subscription  = useSelector(selectSubscription)
  const isOrdering    = useSelector(selectSubLoading)
  const isVerifying   = useSelector(selectSubVerifying)
  const [openFaq, setOpenFaq]             = useState(null)
  const [paymentStage, setPaymentStage]   = useState(null)  // null | 'creating' | 'checkout' | 'verifying' | 'success' | 'error'
  const [showHistory, setShowHistory]     = useState(false)

  useEffect(() => {
    dispatch(fetchSubscriptionStatus())
    dispatch(fetchPlans())

    // Dynamically load Razorpay SDK on mount
    if (typeof window !== 'undefined' && !window.Razorpay) {
      const script = document.createElement('script')
      script.src = 'https://checkout.razorpay.com/v1/checkout.js'
      script.async = true
      document.body.appendChild(script)
    }
  }, [dispatch])

  const plans = subscription.plans.length ? subscription.plans : PLANS_FALLBACK

  const isRazorpayLoaded = () => typeof window !== 'undefined' && typeof window.Razorpay === 'function'

  const toast = useCallback((type, message) => {
    window.dispatchEvent(new CustomEvent('toast', { detail: { type, message } }))
  }, [])

  const handleUpgrade = async (planId) => {
    if (!isRazorpayLoaded()) {
      toast('error', 'Payment system not available. Please refresh the page and try again.')
      return
    }

    if (isOrdering || isVerifying || paymentStage) return
    dispatch(clearError())

    try {
      setPaymentStage('creating')
      const orderAction = await dispatch(createOrder(planId))

      if (orderAction.error || !orderAction.payload) {
        const msg = orderAction.payload || 'Failed to create payment order. Please try again.'
        toast('error', msg)
        setPaymentStage('error')
        setTimeout(() => setPaymentStage(null), 2000)
        return
      }

      const { orderId, amount, currency } = orderAction.payload
      setPaymentStage('checkout')

      await new Promise((resolve, reject) => {
        const options = {
          key:         import.meta.env.VITE_RAZORPAY_KEY_ID,
          amount,
          currency,
          order_id:    orderId,
          name:        'TripSetGo',
          description: 'Pro Monthly Subscription',
          image:       '/favicon.svg',
          prefill: {
            name:  '',
            email: '',
          },
          theme: { color: '#6366f1' },

          handler: async (response) => {
            try {
              setPaymentStage('verifying')
              const verifyAction = await dispatch(verifyPayment({
                razorpay_order_id:   response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature:  response.razorpay_signature,
                planId,
              }))

              if (verifyAction.error || !verifyAction.payload) {
                const msg = verifyAction.payload || 'Payment verification failed. Please contact support if the amount was deducted.'
                toast('error', msg)
                setPaymentStage('error')
                setTimeout(() => setPaymentStage(null), 3000)
                reject(new Error(msg))
                return
              }

              setPaymentStage('success')
              toast('success', '🎉 Welcome to Pro! Your subscription is now active.')
              dispatch(fetchSubscriptionStatus())
              setTimeout(() => setPaymentStage(null), 2500)
              resolve()
            } catch (err) {
              setPaymentStage('error')
              toast('error', 'An unexpected error occurred. Please check your payment status.')
              setTimeout(() => setPaymentStage(null), 3000)
              reject(err)
            }
          },

          modal: {
            ondismiss: () => {
              setPaymentStage(null)
              toast('info', 'Payment cancelled. You can try again whenever you\'re ready.')
              resolve()
            },
            confirm_close: true,
          },
        }

        const rzp = new window.Razorpay(options)

        rzp.on('payment.failed', (response) => {
          const reason = response.error?.description || 'Payment was declined'
          toast('error', `Payment failed: ${reason}`)
          setPaymentStage('error')
          setTimeout(() => setPaymentStage(null), 3000)
          resolve()
        })

        rzp.open()
      })

    } catch (err) {
      console.error('[Subscription] Upgrade failed:', err)
      if (paymentStage !== 'success') {
        toast('error', 'An unexpected error occurred. Please try again.')
        setPaymentStage(null)
      }
    }
  }

  const toggleFaq = (index) => setOpenFaq(openFaq === index ? null : index)

  const handleShowHistory = () => {
    if (!showHistory) dispatch(fetchPaymentHistory())
    setShowHistory(h => !h)
  }

  const isPlanBusy = isOrdering || isVerifying || !!paymentStage
  const isPro = subscription.plan === 'pro' && subscription.isActive

  return (
    <>
      <AnimatePresence>
        {paymentStage && <PaymentOverlay key="overlay" stage={paymentStage} />}
      </AnimatePresence>

      <div className="animate-fadeIn max-w-5xl mx-auto px-4 md:px-6 py-4 flex flex-col gap-8">
        
        {/* Page Header */}
        <div className="text-center py-6 flex flex-col items-center gap-2">
          <h1 className="text-3xl font-extrabold text-text-primary font-display tracking-tight leading-tight">
            Choose Your Perfect <span className="text-indigo-400">Adventure Plan</span>
          </h1>
          <p className="text-xs text-text-secondary max-w-md">
            Unlock Gemini-powered itineraries, Mapbox routing lines, and collaborative group expense trackers.
          </p>

          {isPro && (
            <div className="mt-4 flex flex-col items-center gap-1.5 animate-fadeIn">
              <Badge label="✓ Pro Tier Active" variant="green" />
              {subscription.endDate && (
                <p className="text-[10px] text-text-muted flex items-center gap-1 font-medium">
                  <Clock size={11} /> Renews on {new Date(subscription.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Usage Tracker Progress Container */}
        {subscription.usage && (
          <div className="bg-surface-default border border-border/40 rounded-2xl p-5 max-w-xl mx-auto w-full shadow-sm flex flex-col gap-2.5">
            <div className="flex justify-between items-center text-xs">
              <div>
                <p className="font-bold text-text-primary">Today's Usage</p>
                <p className="text-[10px] text-text-muted mt-0.5">Daily AI trip plan generations capacity</p>
              </div>
              <span className="font-extrabold text-indigo-400 font-display">
                {subscription.usage.searchesToday}
                <span className="text-text-muted font-normal"> / {subscription.usage.searchLimit >= 9999 ? '∞' : subscription.usage.searchLimit}</span>
              </span>
            </div>

            <div className="h-2 bg-surface-raised rounded-full overflow-hidden border border-border/10">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 rounded-full transition-all duration-500"
                style={{
                  width: subscription.usage.searchLimit >= 9999
                    ? '100%'
                    : `${Math.min((subscription.usage.searchesToday / subscription.usage.searchLimit) * 100, 100)}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Pricing Cards Grid */}
        <div className="flex gap-6 justify-center flex-wrap">
          {plans.map((plan, i) => {
            const isPlanPro = plan.id === 'pro'
            const isCurrentPlan = subscription.plan === plan.id && (plan.id === 'free' || subscription.isActive)
            const priceInRupees = plan.price > 0 ? Math.round(plan.price / 100) : 0

            return (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08, duration: 0.4 }}
                className={`
                  w-[310px] rounded-2xl p-6 relative overflow-hidden flex flex-col justify-between transition-all
                  ${isPlanPro
                    ? 'bg-surface-default border-2 border-indigo-500/50 shadow-md shadow-indigo-500/5'
                    : 'bg-surface-default border border-border/40 shadow-sm'
                  }
                `}
              >
                {/* RECOMMENDED Badge overlay */}
                {isPlanPro && (
                  <div className="absolute top-3.5 right-3.5 bg-indigo-500 text-white text-[8px] font-extrabold px-2 py-0.5 rounded-full tracking-wider shrink-0 flex items-center gap-0.5">
                    RECOMMENDED
                  </div>
                )}

                <div className="flex flex-col gap-4">
                  {/* Card Header Title */}
                  <div className="flex items-center gap-2">
                    {isPlanPro
                      ? <Crown size={18} className="text-amber-400" />
                      : <Zap size={18} className="text-indigo-400" />
                    }
                    <h2 className="font-extrabold text-sm text-text-primary font-display leading-tight">{plan.name}</h2>
                  </div>

                  {/* Plan Price */}
                  <div>
                    <span className="text-3xl font-extrabold text-text-primary font-display tracking-tight leading-none">
                      {priceInRupees === 0 ? 'Free' : `₹${priceInRupees}`}
                    </span>
                    {priceInRupees > 0 && (
                      <span className="text-text-secondary text-xs ml-1">/{plan.period}</span>
                    )}
                  </div>

                  <hr className="border-border/10 my-1" />

                  {/* Features list checks */}
                  <ul className="flex flex-col gap-2.5 text-xs">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-center gap-2 text-text-secondary font-medium leading-tight">
                        <Check size={13} className="text-indigo-400 shrink-0" /> {f}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Card CTA Trigger Action Button */}
                <button
                  id={`plan-btn-${plan.id}`}
                  disabled={isCurrentPlan || isPlanBusy}
                  onClick={() => !isCurrentPlan && plan.id !== 'free' && handleUpgrade(plan.id)}
                  aria-label={isCurrentPlan ? 'Current plan' : `Upgrade to ${plan.name}`}
                  className={`
                    w-full py-3 px-4 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all mt-6 cursor-pointer
                    ${isCurrentPlan
                      ? 'bg-surface-raised text-text-muted cursor-not-allowed border border-border/10'
                      : isPlanPro
                        ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/10'
                        : 'bg-surface-raised border border-border/20 text-text-secondary hover:bg-surface-hover'
                    }
                  `}
                >
                  {isCurrentPlan && '✓ Current Plan'}
                  {!isCurrentPlan && plan.id === 'free' && 'Free Tier'}
                  {!isCurrentPlan && isPlanPro && !isPlanBusy && (
                    <>
                      <CreditCard size={13} /> Upgrade to Pro
                    </>
                  )}
                  {!isCurrentPlan && isPlanPro && isPlanBusy && (
                    <>
                      <Loader2 size={13} className="animate-spin" /> Processing…
                    </>
                  )}
                </button>
              </motion.div>
            )
          })}
        </div>

        {/* Visual Showcase Grid detailing Pro benefits */}
        <div className="border-t border-border/20 pt-8 flex flex-col gap-5">
          <h3 className="text-xs font-extrabold text-text-primary font-display uppercase tracking-wider pl-1 flex items-center gap-1.5">
            <Crown size={12} className="text-indigo-400" /> Pro Capability Showcases
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: <Sparkles size={16} className="text-indigo-400" />, title: 'AI Itinerary Quality', desc: 'Detailed schedules built on priority Gemini computing models.' },
              { icon: <Map size={16} className="text-cyan-400" />, title: 'Interactive Map Overlays', desc: 'Visual Mapbox route plotting and custom destination badges.' },
              { icon: <DollarSign size={16} className="text-emerald-400" />, title: 'Budget Intelligence', desc: 'Collaborative expense split calculations and invoice timeline logs.' },
              { icon: <Download size={16} className="text-amber-400" />, title: 'Offline Exports', desc: 'Download high-fidelity PDF/Excel schedules for remote usage.' }
            ].map((showcase, index) => (
              <div key={index} className="bg-surface-default border border-border/40 p-4 rounded-xl shadow-sm flex flex-col gap-2 text-xs">
                <div className="w-8 h-8 rounded-lg bg-surface-raised border border-border flex items-center justify-center shadow-sm">
                  {showcase.icon}
                </div>
                <h4 className="font-bold text-text-primary mt-1.5">{showcase.title}</h4>
                <p className="text-[10px] text-text-secondary leading-relaxed font-medium">{showcase.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* SSL & PCI payment gateways trust tags */}
        <div className="flex gap-4 justify-center flex-wrap text-[10px] text-text-muted font-bold uppercase tracking-wider py-4">
          <span className="flex items-center gap-1"><Shield size={12} /> SSL Encrypted Checkout</span>
          <span className="flex items-center gap-1"><CreditCard size={12} /> Razorpay Secure Gateway</span>
          <span className="flex items-center gap-1"><RefreshCw size={12} /> Cancel Anytime</span>
        </div>

        {/* Payment invoices history toggle logs drawer */}
        {isPro && (
          <div className="bg-surface-default border border-border/40 rounded-2xl overflow-hidden shadow-sm">
            <button
              onClick={handleShowHistory}
              className="w-full py-3.5 px-4 bg-transparent border-none cursor-pointer flex justify-between items-center text-left text-xs font-bold text-text-primary outline-none"
            >
              <span className="flex items-center gap-1.5">
                <History size={14} className="text-indigo-400" /> Payment History Invoices
              </span>
              {showHistory ? <ChevronUp size={14} className="text-indigo-400" /> : <ChevronDown size={14} className="text-text-muted" />}
            </button>

            <AnimatePresence>
              {showHistory && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <div className="border-t border-border/10 bg-surface-raised/30">
                    {subscription.paymentHistory?.length > 0
                      ? subscription.paymentHistory.map(p => <PaymentHistoryRow key={p._id} payment={p} />)
                      : (
                        <div className="py-8 text-center text-text-muted text-xs font-medium">
                          No payment records found.
                        </div>
                      )
                    }
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* FAQs Accordions list */}
        <div className="border-t border-border/20 pt-8 flex flex-col gap-6">
          <div className="text-center flex flex-col items-center gap-1.5">
            <h3 className="text-lg font-extrabold text-text-primary font-display">Frequently Asked Questions</h3>
            <p className="text-[10px] text-text-secondary font-medium">Everything you need to know about TripSetGo billing</p>
          </div>

          <div className="flex flex-col gap-2.5 max-w-xl mx-auto w-full">
            {FAQS.map((faq, index) => {
              const isOpen = openFaq === index
              return (
                <div
                  key={index}
                  className="bg-surface-default border border-border/40 rounded-xl overflow-hidden shadow-sm"
                >
                  <button
                    id={`faq-${index}`}
                    onClick={() => toggleFaq(index)}
                    aria-expanded={isOpen}
                    className="w-full py-3.5 px-4 bg-transparent border-none cursor-pointer flex justify-between items-center text-left text-xs font-bold text-text-primary outline-none"
                  >
                    <span>{faq.q}</span>
                    {isOpen
                      ? <ChevronUp size={14} className="text-indigo-400" />
                      : <ChevronDown size={14} className="text-text-muted" />
                    }
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                      >
                        <div className="px-4 pb-4 pt-0 text-[11px] text-text-secondary leading-relaxed border-t border-border/10 font-medium">
                          {faq.a}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </>
  )
}
