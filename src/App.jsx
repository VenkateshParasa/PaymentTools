import { useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes } from 'react-router-dom'
import { BarChart3, FileCode2, ListChecks, Moon, PackageCheck, Sun, Wrench } from 'lucide-react'
import SchemaSamplePage from './pages/SchemaSamplePage.jsx'
import RulesScenariosPage from './pages/RulesScenariosPage.jsx'
import ScenarioPackPage from './pages/ScenarioPackPage.jsx'
import SampleAnalyticsPage from './pages/SampleAnalyticsPage.jsx'

const TOOLS = [
  { to: '/schema', label: 'Schema to Sample', desc: 'Load an XSD, see which fields are mandatory or optional, and generate a sample XML message.', icon: FileCode2 },
  { to: '/rules', label: 'Rules & Scenarios', desc: 'Load an XSD and the ISO 20022 MDR PDF: see which rules are covered and get valid/invalid scenarios.', icon: ListChecks },
  { to: '/pack', label: 'Scenario Pack', desc: 'XSD + MDR PDF (+ optional client base sample): Excel of all scenarios and combinations, with a complete XML sample for each.', icon: PackageCheck },
  { to: '/analytics', label: 'Sample Analytics', desc: 'Load many client samples and see which value patterns, lengths and choice branches they use. Descriptive only.', icon: BarChart3 },
]

function Home() {
  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <h1 className="flex items-center gap-2 text-3xl font-bold text-slate-800 dark:text-slate-100"><Wrench className="text-brand-600" /> Payments Tools</h1>
        <p className="mt-2 text-slate-500">Developer utilities for ISO 20022 message work. Everything runs in your browser; files you load are not uploaded.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {TOOLS.map(({ to, label, desc, icon: Icon }) => (
            <Link key={to} to={to} className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900">
              <Icon className="text-brand-600" size={22} />
              <h2 className="mt-2 font-semibold text-slate-800 dark:text-slate-100">{label}</h2>
              <p className="mt-1 text-sm text-slate-500">{desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [dark, setDark] = useState(() => localStorage.getItem('pt-theme') === 'dark')
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('pt-theme', dark ? 'dark' : 'light')
  }, [dark])

  const link = ({ isActive }) => `rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
          <Link to="/" className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100"><Wrench size={18} className="text-brand-600" /> Payments Tools</Link>
          <nav className="flex gap-1">
            {TOOLS.map((t) => <NavLink key={t.to} to={t.to} className={link}>{t.label}</NavLink>)}
          </nav>
          <button onClick={() => setDark((d) => !d)} className="ml-auto rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Toggle dark mode">
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/schema" element={<SchemaSamplePage />} />
          <Route path="/rules" element={<RulesScenariosPage />} />
          <Route path="/pack" element={<ScenarioPackPage />} />
          <Route path="/analytics" element={<SampleAnalyticsPage />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
    </div>
  )
}
