import type { ReactNode } from 'react'
import { ButtonBase, Card } from '@mui/material'
import ChevronRight from '@mui/icons-material/ChevronRight'

export function DirectoryCard({ children, disabled, onClick, label }: {
  children: ReactNode; disabled: boolean; onClick: () => void; label: string
}) {
  return <Card sx={{ mb: 1.25 }}>
    <ButtonBase disabled={disabled} onClick={onClick} aria-label={label}
      sx={{ width: '100%', minHeight: 54, px: 1.25, py: .5, gap: 1, justifyContent: 'space-between',
        textAlign: 'start', '&.Mui-focusVisible': { outline: '2px solid', outlineOffset: -2 } }}>
      {children}
      <ChevronRight aria-hidden />
    </ButtonBase>
  </Card>
}
