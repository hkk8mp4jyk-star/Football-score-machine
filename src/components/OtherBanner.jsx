// Grote aankondiging wanneer beide rollen op de ster stoppen.
export default function OtherBanner({ show }) {
  if (!show) return null
  return (
    <div className="other-banner" role="status">
      <div className="other-rays" aria-hidden="true" />
      <div className="other-text">
        <span className="other-star" aria-hidden="true">★</span>
        <span className="other-line">Overige</span>
        <span className="other-line">uitslagen</span>
      </div>
    </div>
  )
}
