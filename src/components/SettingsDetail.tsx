import type { ReactNode } from 'react'
import { Button, Card } from '@mui/material'
import ArrowBack from '@mui/icons-material/ArrowBack'

export function SettingsDetail({ backLabel, onBack, busy, children }: {
  backLabel: string; onBack: () => void; busy: boolean; children: ReactNode
}) {
  return <>
    <Button color="secondary" startIcon={<ArrowBack />} disabled={busy} onClick={onBack}>{backLabel}</Button>
    <Card component="section" sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>{children}</Card>
  </>
}
