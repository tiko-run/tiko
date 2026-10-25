import { createContext, useContext } from 'react'

/** True on a board the person can only view: elements hide their editing controls. */
export const ReadOnlyContext = createContext(false)

export const useReadOnly = () => useContext(ReadOnlyContext)

/** True when the board is zoomed so far out that elements are drawn as blocks. */
export const FarContext = createContext(false)
