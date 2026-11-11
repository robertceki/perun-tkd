import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'

export function Feedback({ errors = [], message }: { errors?: string[]; message?: string }) {
  return <>{errors.length > 0 && <div className="alert alert-danger" role="alert"><ul className="mb-0">{errors.map((error, i) => <li key={i}>{error}</li>)}</ul></div>}{message && <div className="alert alert-info" role="status">{message}</div>}</>
}
export function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId()
  return <div className="mb-3"><label className="form-label" htmlFor={id}>{label}</label><input {...props} id={id} className="form-control" /></div>
}
export function SelectField({ label, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId()
  return <div className="mb-3"><label className="form-label" htmlFor={id}>{label}</label><select {...props} id={id} className="form-select">{children}</select></div>
}
export function Check({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId()
  return <div className="form-check mb-3"><input {...props} id={id} type="checkbox" className="form-check-input" /><label className="form-check-label" htmlFor={id}>{label}</label></div>
}
export function FormActions({ busy, cancel }: { busy: boolean; cancel: () => void }) {
  return <div className="d-flex gap-2 flex-wrap"><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Čuvanje…' : 'Sačuvaj'}</button><button className="btn btn-outline-secondary" type="button" disabled={busy} onClick={cancel}>Otkaži</button></div>
}
