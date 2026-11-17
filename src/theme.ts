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
    button: { fontWeight: 700, textTransform: 'none' },
  },
  components: {
    MuiButton: { styleOverrides: { root: { minHeight: 40, padding: '0 12px', fontSize: '.8125rem', borderRadius: 24 } } },
    MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { borderColor: '#e5ded1', boxShadow: '0 2px 8px #30271609' } } },
    MuiOutlinedInput: { styleOverrides: { root: { minHeight: 40, fontSize: '1rem' }, input: { padding: '8px 12px' }, multiline: { padding: '8px 12px', '& textarea': { padding: 0 } } } },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
  },
})
