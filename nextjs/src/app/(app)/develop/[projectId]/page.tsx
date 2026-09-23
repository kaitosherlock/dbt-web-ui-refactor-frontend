"use client"

import React from "react"
import { useParams } from "next/navigation"
import DevelopLayout from "@/features/develop/components/DevelopLayout"

export default function ProjectIDEPage() {
  const params = useParams()
  const projectId = params.projectId as string

  return <DevelopLayout projectId={projectId} />
}
