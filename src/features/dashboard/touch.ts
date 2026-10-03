let dashboardTouchStart: number | null = null
let tracksDashboard = false
const isMobile = () => window.matchMedia('(max-width: 760px)').matches
const getDashboardTabs = () => document.querySelector('.dash-tabs')

document.addEventListener('touchstart', event => {
  const target = event.target instanceof Element ? event.target : null
  const tabs = getDashboardTabs()
  if (!isMobile() || !tabs || !target || target.closest('button, input, textarea, select')) return
  tracksDashboard = Boolean(target.closest('.head, .dash-tabs, .dashboard-panels'))
  dashboardTouchStart = tracksDashboard ? event.touches[0]?.clientY ?? null : null
}, { passive: true })

document.addEventListener('touchmove', event => {
  if (!tracksDashboard || dashboardTouchStart === null) return
  const delta = (event.touches[0]?.clientY ?? dashboardTouchStart) - dashboardTouchStart
  if (Math.abs(delta) > 8 && event.cancelable) event.preventDefault()
}, { passive: false })

document.addEventListener('touchend', event => {
  const tabs = getDashboardTabs()
  if (!tracksDashboard || dashboardTouchStart === null || !tabs) {
    tracksDashboard = false
    dashboardTouchStart = null
    return
  }
  const delta = (event.changedTouches[0]?.clientY ?? dashboardTouchStart) - dashboardTouchStart
  if (delta < -36) tabs.classList.add('dashboard-raised')
  if (delta > 36) tabs.classList.remove('dashboard-raised')
  tracksDashboard = false
  dashboardTouchStart = null
}, { passive: true })

