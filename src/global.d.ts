import type ParseType from 'parse'

declare global {
  interface Window {
    Parse: typeof ParseType
  }
}

export {}
