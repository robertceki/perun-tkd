import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { Alert, Box, Button, Checkbox, CircularProgress, FormControl, FormControlLabel, InputLabel, NativeSelect, OutlinedInput, Stack, TextField, Typography } from '@mui/material'

export function Feedback({ errors = [], message }: { errors?: string[]; message?: string }) {
  return <Stack spacing={1} sx={errors.length || message ? { mb: 2 } : undefined}>
    {errors.length > 0 && <Alert severity="error"><Box component="ul" sx={{ m: 0, pl: 2 }}>{errors.map((error, i) => <li key={i}>{error}</li>)}</Box></Alert>}
    {message && <Alert variant="outlined" severity="info" role="status">{message}</Alert>}
  </Stack>
}
export function Field({ label, onChange, value, defaultValue, type, required, disabled, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId()
  return <TextField id={id} label={label} type={type} value={value} defaultValue={defaultValue} required={required} disabled={disabled}
    onChange={onChange} sx={{ mb: 1.25 }} slotProps={{ htmlInput: { "aria-label": label, ...input }, inputLabel: type === 'date' || type === 'time' || type === 'month' ? { shrink: true } : undefined }} />
}
export function SelectField({ label, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId()
  return <FormControl fullWidth size="small" required={props.required} disabled={props.disabled} sx={{ mb: 1.25 }}>
    <InputLabel htmlFor={id} shrink>{label}</InputLabel>
    <NativeSelect value={props.value} defaultValue={props.defaultValue} onChange={props.onChange}
      input={<OutlinedInput label={label} notched />} inputProps={{ id, "aria-label": label, name: props.name, autoComplete: props.autoComplete, required: props.required }}>{children}</NativeSelect>
  </FormControl>
}
export function Check({ label, checked, defaultChecked, disabled, required, onChange, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <Box sx={{ mb: 1.25 }}><FormControlLabel label={label} disabled={disabled}
    control={<Checkbox size="small" color="secondary" checked={checked} defaultChecked={defaultChecked} required={required}
      slotProps={{ input }} onChange={onChange} />} /></Box>
}
export function FormActions({ busy, cancel }: { busy: boolean; cancel: () => void }) {
  return <Stack direction="row" useFlexGap flexWrap="wrap" gap={1}><Button variant="contained" type="submit" disabled={busy}>{busy ? 'Čuvanje…' : 'Sačuvaj'}</Button><Button variant="outlined" color="secondary" type="button" disabled={busy} onClick={cancel}>Otkaži</Button></Stack>
}

export function PendingStatus({ children }: { children: ReactNode }) {
  return <Stack direction="row" alignItems="center" gap={1} role="status" sx={{ mb: 1.5 }}>
    <CircularProgress size={14} color="inherit" aria-hidden="true" />
    <Typography variant="body2">{children}</Typography>
  </Stack>
}
