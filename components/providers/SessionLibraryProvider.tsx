"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { loadSessions, saveSessions } from "@/lib/sessions/sessionStorage";
import type { TherapySession } from "@/lib/sessions/sessionTypes";

type SessionLibraryContextValue = {
  sessions: TherapySession[];
  saveSession: (session: TherapySession) => void;
  deleteSession: (sessionId: string) => void;
};

const SessionLibraryContext = createContext<SessionLibraryContextValue | null>(null);

export function SessionLibraryProvider({
  children
}: {
  children: React.ReactNode;
}) {
  const [sessions, setSessions] = useState<TherapySession[]>([]);

  useEffect(() => {
    setSessions(loadSessions());
  }, []);

  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  const value = useMemo<SessionLibraryContextValue>(() => {
    return {
      sessions,
      saveSession: (session) => {
        setSessions((prev) => {
          const withoutSameId = prev.filter((item) => item.id !== session.id);
          return [...withoutSameId, session];
        });
      },
      deleteSession: (sessionId) => {
        setSessions((prev) => prev.filter((item) => item.id !== sessionId));
      }
    };
  }, [sessions]);

  return (
    <SessionLibraryContext.Provider value={value}>
      {children}
    </SessionLibraryContext.Provider>
  );
}

export function useSessionLibrary() {
  const context = useContext(SessionLibraryContext);

  if (!context) {
    throw new Error("useSessionLibrary must be used inside SessionLibraryProvider");
  }

  return context;
}
