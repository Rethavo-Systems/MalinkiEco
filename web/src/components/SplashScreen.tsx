import { SiteFooter } from './SiteFooter'

export function SplashScreen({ message }: { message: string }) {
  return (
    <div className="shell loading-shell">
      <section className="loading-card" role="status" aria-live="polite" aria-busy="true">
        <p className="loading-brand">MalinkiEco</p>
        <div className="loading-orbit" aria-hidden="true"><span /><span /><span /></div>
        <h1>{message}</h1>
        <p className="loading-caption">Подключаемся к вашему кабинету</p>
        <div className="loading-track" aria-hidden="true"><span /></div>
      </section>
      <SiteFooter />
    </div>
  )
}
