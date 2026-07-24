// src/components/common/Avatar.jsx
// Aurora Design System — User avatar with initials fallback and optional status

export default function Avatar({ src, name, size = 'md', status, className = '' }) {
  const sizes = { xs: 28, sm: 36, md: 44, lg: 64, xl: 96 }
  const px = sizes[size] || 44
  const initials = name
    ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '?'

  const statusColors = {
    online:  'var(--color-emerald-500)',
    offline: 'var(--color-text-muted)',
    busy:    'var(--color-rose-500)',
    away:    'var(--color-amber-500)',
  }

  const statusSize = Math.max(Math.round(px * 0.27), 8)

  return (
    <div className={`relative inline-flex shrink-0 rounded-full ${className}`} style={{ width: px, height: px }}>
      <div
        style={{
          width: px,
          height: px,
          borderRadius: '50%',
          overflow: 'hidden',
          background: src ? 'var(--color-surface-raised)' : 'var(--color-indigo-700)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: px * 0.36,
          fontWeight: 700,
          fontFamily: 'var(--font-family-display)',
          color: 'white',
          border: '2px solid var(--color-border-default)',
          userSelect: 'none',
        }}
      >
        {src ? (
          <img
            src={src}
            alt={name || 'Avatar'}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
          />
        ) : (
          <span>{initials}</span>
        )}
      </div>

      {/* Status indicator dot */}
      {status && statusColors[status] && (
        <span
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: statusSize,
            height: statusSize,
            borderRadius: '50%',
            background: statusColors[status],
            border: '2px solid var(--color-surface-base)',
          }}
          aria-label={`Status: ${status}`}
        />
      )}
    </div>
  )
}
