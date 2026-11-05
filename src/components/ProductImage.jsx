const FALLBACK_IMAGE = '/printcaju-mark.png'

export default function ProductImage({ src, alt = '', className = '', ...props }) {
  const isFallback = !src
  const classes = [className, isFallback && 'product-brand-placeholder'].filter(Boolean).join(' ')

  function useFallback(event) {
    const image = event.currentTarget
    if (image.dataset.fallback === 'true') {
      image.onerror = null
      return
    }
    image.dataset.fallback = 'true'
    image.src = FALLBACK_IMAGE
    image.classList.add('product-brand-placeholder')
  }

  return <img
    src={src || FALLBACK_IMAGE}
    alt={alt}
    className={classes}
    data-fallback={isFallback ? 'true' : undefined}
    onError={useFallback}
    {...props}
  />
}
