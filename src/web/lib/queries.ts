import { useQuery } from '@tanstack/react-query'
import { endpoints } from './api.js'

export function useAccounts() {
  return useQuery({ queryKey: ['accounts'], queryFn: endpoints.accounts, refetchInterval: 20_000 })
}

export function useModels() {
  return useQuery({ queryKey: ['models'], queryFn: endpoints.models, refetchInterval: 60_000 })
}

export function useModelsDev() {
  return useQuery({ queryKey: ['models-dev'], queryFn: endpoints.modelsDev, refetchInterval: 30_000 })
}

export function useSystem() {
  return useQuery({ queryKey: ['system'], queryFn: endpoints.system, refetchInterval: 30_000 })
}

export function useSummary(range: string) {
  return useQuery({ queryKey: ['summary', range], queryFn: () => endpoints.summary(range), refetchInterval: 15_000 })
}

export function useBenefitSummary() {
  return useQuery({ queryKey: ['benefit-summary'], queryFn: endpoints.benefitSummary, refetchInterval: 30_000 })
}

export function useBenefitEvents(limit = 100) {
  return useQuery({ queryKey: ['benefit-events', limit], queryFn: () => endpoints.benefitEvents(limit), refetchInterval: 30_000 })
}

export function useKeys() {
  return useQuery({ queryKey: ['keys'], queryFn: endpoints.keys })
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: endpoints.settings })
}
