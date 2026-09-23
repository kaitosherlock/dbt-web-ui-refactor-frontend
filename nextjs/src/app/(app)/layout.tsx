"use client"

import React from "react"
import { GlobalProvider } from "@/common/layout/GlobalContext"
import AppLayout from "@/common/layout/AppLayout"

export default function V2AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <GlobalProvider>
      <AppLayout>{children}</AppLayout>
    </GlobalProvider>
  )
}
