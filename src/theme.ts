import { createTheme } from '@mui/material/styles'

export const perunTheme = createTheme({
  palette: {
    primary: { main: '#C5A45E', contrastText: '#222229' },
    secondary: { main: '#222229' },
    background: { default: '#FAF8F3', paper: '#fff' },
    text: { primary: '#222229', secondary: '#615c54' },
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: 'system-ui, sans-serif',
    h4: { fontWeight: 800, letterSpacing: '-.045em' },
    body1: { '@media (max-width: 599px)': { fontSize: '1.0625rem' } },
    body2: { fontSize: '.9375rem' },
    button: { fontWeight: 700, textTransform: 'none' },
  },
  components: {
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { minHeight: 40, padding: '0 12px', fontSize: '.8125rem', borderRadius: 24, '&:active:not(:disabled)': { filter: 'brightness(.94)' }, '@media (max-width: 599px)': { minHeight: 44, minWidth: 44, fontSize: '.9375rem' } } } },
    MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { borderColor: '#e5ded1', boxShadow: '0 2px 8px #30271609' } } },
    MuiOutlinedInput: { styleOverrides: { root: { minHeight: 40, fontSize: '1rem', '@media (max-width: 599px)': { minHeight: 44 } }, input: { padding: '8px 12px' }, multiline: { padding: '8px 12px', '& textarea': { padding: 0 } } } },
    MuiBottomNavigationAction: { styleOverrides: { label: { '@media (max-width: 599px)': { fontSize: '.875rem', '&.Mui-selected': { fontSize: '.875rem', fontWeight: 700 } } } } },
    MuiIconButton: { styleOverrides: { root: { '@media (max-width: 599px)': { minWidth: 44, minHeight: 44 } } } },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
  },
})
