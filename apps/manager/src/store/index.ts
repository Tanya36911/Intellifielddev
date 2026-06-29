import { configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'
import auth from './auth'

// makeStore exists so tests can build a fresh, isolated store each time.
export function makeStore() {
  return configureStore({ reducer: { auth } })
}

export const store = makeStore()

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()

export const selectSession = (state: RootState) => state.auth.session
