import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

/**
 * Floating assistant: answers questions from the verified Q1–Q6 findings
 * using the local Dashboard Royale assistant service (Ollama, no cloud APIs).
 *
 * It only works in local mode. A deployed copy (for example on Netlify) never
 * sends a request: it explains that the assistant runs on a local model.
 */

const CHAT_ENDPOINT = '/api/assistant/chat'
const HEALTH_ENDPOINT = '/api/assistant/health'
const STORAGE_KEY = 'dashboard-royale-assistant'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** True when the dashboard is served from this machine (dev server or local preview). */
const LOCAL_MODE = import.meta.env.DEV || LOCAL_HOSTS.has(window.location.hostname)

const LOCAL_ONLY_MESSAGE =
  'The AI assistant runs on a local model (Ollama) and is available only when Dashboard Royale runs locally. Everything else on this dashboard works here.'
const OFFLINE_MESSAGE =
  'The AI assistant is available only in local mode, with Ollama and the assistant service running. Start them with `brew services start ollama` and the service on port 8100 (see Dashboard-Royale/assistant/README.md).'

type Availability = 'checking' | 'ready' | 'offline' | 'local-only'

interface Source { id: string; title: string; topic: string; page: string }
interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  unverified?: string[]
  error?: boolean
}

const SUGGESTIONS = [
  'Which machines are underperforming? (Q1)',
  'How did floor demand change? (Q2)',
  'How much downtime was there? (Q3)',
  'How concentrated are player losses? (Q4)',
  'What changed in the comp program? (Q5)',
  'How would you spend the $100,000? (Q6)',
]

/** One link per question, in the order they were cited; titles go in the tooltip. */
function uniqueTopics(sources: Source[]) {
  const byTopic = new Map<string, { topic: string; page: string; titles: string[] }>()
  for (const s of sources) {
    const item = byTopic.get(s.topic) ?? { topic: s.topic, page: s.page, titles: [] }
    item.titles.push(s.title)
    byTopic.set(s.topic, item)
  }
  return [...byTopic.values()]
}

function loadHistory(): Message[] {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    return saved ? (JSON.parse(saved) as Message[]) : []
  } catch {
    return []
  }
}

export function AssistantChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>(loadHistory)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [availability, setAvailability] = useState<Availability>(LOCAL_MODE ? 'checking' : 'local-only')

  const checkAvailability = async () => {
    if (!LOCAL_MODE) return
    setAvailability('checking')
    try {
      const response = await fetch(HEALTH_ENDPOINT, { cache: 'no-store' })
      const body = await response.json().catch(() => null)
      setAvailability(response.ok && body?.status === 'ok' ? 'ready' : 'offline')
    } catch {
      setAvailability('offline')
    }
  }

  // Check once when the panel is first opened in local mode.
  useEffect(() => {
    if (open && LOCAL_MODE && availability === 'checking') checkAvailability()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)))
    } catch {
      // Storage can be unavailable (private mode); history then lasts for this page only.
    }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (open) inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => () => abortRef.current?.abort(), [])

  const send = async (text: string) => {
    const question = text.trim()
    if (!question || loading || !LOCAL_MODE) return

    // Failed turns are not sent back to the model as conversation history.
    const history = messages.filter((m) => !m.error).map(({ role, content }) => ({ role, content }))
    setMessages((m) => [...m, { role: 'user', content: question }])
    setInput('')
    setLoading(true)

    const controller = new AbortController()
    abortRef.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 150_000)

    try {
      const response = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question.slice(0, 1000), history: history.slice(-6) }),
        signal: controller.signal,
      })
      const body = await response.json().catch(() => null)

      if (!response.ok) {
        // 503 = Ollama is down; other 5xx without a body = the service itself is down.
        if (response.status >= 500) {
          setAvailability('offline')
          throw new Error(OFFLINE_MESSAGE)
        }
        throw new Error(typeof body?.detail === 'string' ? body.detail : `The assistant returned an error (${response.status}).`)
      }

      setAvailability('ready')
      setMessages((m) => [...m, { role: 'assistant', content: body.answer, sources: body.sources, unverified: body.unverified_numbers }])
    } catch (error) {
      const message = error instanceof DOMException && error.name === 'AbortError'
        ? 'The local model took too long to answer. Try a shorter question.'
        : error instanceof TypeError
          ? OFFLINE_MESSAGE
          : (error as Error).message
      setMessages((m) => [...m, { role: 'assistant', content: message, error: true }])
    } finally {
      window.clearTimeout(timeout)
      setLoading(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    send(input)
  }

  const lastQuestion = [...messages].reverse().find((m) => m.role === 'user')?.content

  return (
    <>
      <button
        className={`assistant-fab ${open ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="assistant-panel"
        aria-label={open ? 'Close AI assistant' : 'Open AI assistant'}
      >
        {open ? '×' : 'AI'}
      </button>

      {open && (
        <aside id="assistant-panel" className="assistant-panel" role="dialog" aria-label="AI assistant">
          <header className="assistant-head">
            <div>
              <div className="assistant-title">Ask the findings</div>
              <div className="small muted">{LOCAL_MODE ? 'Local AI · answers only from verified Q1–Q6 results' : 'Local AI · available when running locally'}</div>
            </div>
            {messages.length > 0 && (
              <button className="btn sm" onClick={() => setMessages([])} disabled={loading}>Clear</button>
            )}
          </header>

          <div className="assistant-messages" ref={listRef} aria-live="polite">
            {availability === 'local-only' && (
              <div className="assistant-notice">
                <div className="strong">Available in local mode only</div>
                <p className="small secondary">{LOCAL_ONLY_MESSAGE}</p>
              </div>
            )}
            {availability === 'offline' && (
              <div className="assistant-notice">
                <div className="strong">The AI assistant isn't running</div>
                <p className="small secondary">{OFFLINE_MESSAGE}</p>
                <button className="btn sm mt-s" onClick={checkAvailability}>Check again</button>
              </div>
            )}
            {availability === 'checking' && messages.length === 0 && <p className="small muted">Connecting to the local model…</p>}

            {availability === 'ready' && messages.length === 0 && (
              <div className="assistant-empty">
                <p className="small secondary">Ask about any of the six challenge questions. Answers come from the dashboard's verified figures, and each lists its sources.</p>
                <div className="assistant-suggestions">
                  {SUGGESTIONS.map((s) => <button key={s} className="btn sm" onClick={() => send(s)}>{s}</button>)}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`assistant-msg ${m.role} ${m.error ? 'error' : ''}`}>
                <div className="assistant-bubble">{m.content}</div>
                {m.unverified && m.unverified.length > 0 && (
                  <div className="assistant-warning small">Check these figures on the dashboard; they don't match the sources: {m.unverified.join(', ')}</div>
                )}
                {m.sources && m.sources.length > 0 && (
                  <div className="assistant-sources">
                    <span className="small muted">Sources:</span>
                    {uniqueTopics(m.sources).map((s) => (
                      <Link key={s.topic} to={s.page} className="badge" title={s.titles.join('\n')} onClick={() => setOpen(false)}>{s.topic}</Link>
                    ))}
                  </div>
                )}
                {m.error && i === messages.length - 1 && lastQuestion && (
                  <button className="btn sm mt-s" onClick={() => { setMessages((all) => all.slice(0, -2)); send(lastQuestion) }}>Retry</button>
                )}
              </div>
            ))}

            {loading && (
              <div className="assistant-msg assistant"><div className="assistant-bubble assistant-typing">Thinking<span>.</span><span>.</span><span>.</span></div></div>
            )}
          </div>

          <form className="assistant-input" onSubmit={submit}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
              placeholder="Ask about Q1–Q6…"
              rows={2}
              maxLength={1000}
              aria-label="Your question"
              disabled={loading || availability !== 'ready'}
            />
            <button type="submit" className="btn gold" disabled={loading || availability !== 'ready' || !input.trim()}>Send</button>
          </form>
        </aside>
      )}
    </>
  )
}
