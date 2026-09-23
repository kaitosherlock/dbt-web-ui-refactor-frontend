import { describe, expect, it } from 'vitest'
import { resolveProjectStatus } from '@/features/home/model/project-status'

describe('resolveProjectStatus', () => {
  it('marks a project whose latest build succeeded as ready (synced), even if sync_status is pending or null', () => {
    expect(
      resolveProjectStatus({
        sync_status: 'pending',
        runs: [{ status: 'success', command: 'build' }],
      }),
    ).toBe('synced')

    expect(
      resolveProjectStatus({
        sync_status: null,
        runs: [{ status: 'success', command: 'run' }],
      }),
    ).toBe('synced')
  })

  it('marks a project whose latest build failed as error (needs attention)', () => {
    expect(
      resolveProjectStatus({
        sync_status: 'synced',
        runs: [{ status: 'error', command: 'build' }],
      }),
    ).toBe('error')

    expect(
      resolveProjectStatus({
        sync_status: 'pending',
        runs: [{ status: 'failed', command: 'run' }],
      }),
    ).toBe('error')
  })

  it('marks a project with a currently running build as syncing', () => {
    expect(
      resolveProjectStatus({
        sync_status: 'pending',
        runs: [{ status: 'running', command: 'build' }],
      }),
    ).toBe('syncing')
  })

  it('falls back to git sync_status when there are no runs', () => {
    expect(resolveProjectStatus({ sync_status: 'synced', runs: [] })).toBe('synced')
    expect(resolveProjectStatus({ sync_status: 'error', runs: [] })).toBe('error')
    expect(resolveProjectStatus({ sync_status: 'syncing', runs: [] })).toBe('syncing')
    expect(resolveProjectStatus({ sync_status: 'pending', runs: [] })).toBe('pending')
    expect(resolveProjectStatus({ sync_status: null, runs: [] })).toBe('pending')
    expect(resolveProjectStatus({})).toBe('pending')
  })
})
