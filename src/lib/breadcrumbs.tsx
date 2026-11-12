import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'

export type BreadcrumbItem = {
  label: string
  to?: string
}

type BreadcrumbsContextType = {
  breadcrumbs: BreadcrumbItem[]
  setBreadcrumbs: (items: BreadcrumbItem[]) => void
}

const BreadcrumbsContext = createContext<BreadcrumbsContextType>({
  breadcrumbs: [],
  setBreadcrumbs: () => {}
})

export function BreadcrumbsProvider({ children }: { children: ReactNode }) {
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([])

  return (
    <BreadcrumbsContext.Provider value={{ breadcrumbs, setBreadcrumbs }}>
      {children}
    </BreadcrumbsContext.Provider>
  )
}

export function useBreadcrumbs() {
  return useContext(BreadcrumbsContext)
}

export function useSetBreadcrumbs(items: BreadcrumbItem[]) {
  const { setBreadcrumbs } = useContext(BreadcrumbsContext)
  const serialized = JSON.stringify(items)

  useEffect(() => {
    setBreadcrumbs(items)
  }, [serialized])
}
