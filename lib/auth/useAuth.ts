'use client'
import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { getSupabaseClient } from '@/lib/supabase/client'
import type { Profile, PhysioProfile } from '@/lib/supabase/types'

export interface AuthState {
  user: User | null
  profile: Profile | null
  physioProfile: PhysioProfile | null
  loading: boolean
  isPhysio: boolean
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [physioProfile, setPhysioProfile] = useState<PhysioProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = getSupabaseClient()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const currentUser = session?.user ?? null
        setUser(currentUser)

        if (currentUser) {
          const [{ data: p }, { data: pp }] = await Promise.all([
            supabase.from('profiles').select('*').eq('id', currentUser.id).single(),
            supabase.from('physio_profiles').select('*, clinic:clinics(*)').eq('id', currentUser.id).single(),
          ])
          setProfile(p ?? null)
          setPhysioProfile(pp ?? null)
        } else {
          setProfile(null)
          setPhysioProfile(null)
        }
        setLoading(false)
      }
    )
    return () => subscription.unsubscribe()
  }, [])

  return {
    user,
    profile,
    physioProfile,
    loading,
    isPhysio: profile?.role === 'physio' || profile?.role === 'clinic_admin',
  }
}
