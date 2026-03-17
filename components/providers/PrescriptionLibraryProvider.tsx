"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ACTIVE_EXERCISE_PRESCRIPTIONS } from "@/lib/exercises";
import { loadCustomPrescriptions, saveCustomPrescriptions } from "@/lib/prescriptions/storage";
import type { ExercisePrescription } from "@/lib/types/exercise";

type PrescriptionLibraryContextValue = {
  defaultPrescriptions: ExercisePrescription[];
  customPrescriptions: ExercisePrescription[];
  allPrescriptions: ExercisePrescription[];
  savePrescription: (prescription: ExercisePrescription) => void;
  deletePrescription: (prescriptionId: string) => void;
};

const PrescriptionLibraryContext =
  createContext<PrescriptionLibraryContextValue | null>(null);

export function PrescriptionLibraryProvider({
  children
}: {
  children: React.ReactNode;
}) {
  const [customPrescriptions, setCustomPrescriptions] = useState<ExercisePrescription[]>([]);

  useEffect(() => {
    setCustomPrescriptions(loadCustomPrescriptions());
  }, []);

  useEffect(() => {
    saveCustomPrescriptions(customPrescriptions);
  }, [customPrescriptions]);

  const value = useMemo<PrescriptionLibraryContextValue>(() => {
    const allPrescriptions = [
      ...ACTIVE_EXERCISE_PRESCRIPTIONS,
      ...customPrescriptions
    ];

    return {
      defaultPrescriptions: ACTIVE_EXERCISE_PRESCRIPTIONS,
      customPrescriptions,
      allPrescriptions,
      savePrescription: (prescription) => {
        setCustomPrescriptions((prev) => {
          const withoutSameId = prev.filter((item) => item.id !== prescription.id);
          return [...withoutSameId, prescription];
        });
      },
      deletePrescription: (prescriptionId) => {
        setCustomPrescriptions((prev) =>
          prev.filter((item) => item.id !== prescriptionId)
        );
      }
    };
  }, [customPrescriptions]);

  return (
    <PrescriptionLibraryContext.Provider value={value}>
      {children}
    </PrescriptionLibraryContext.Provider>
  );
}

export function usePrescriptionLibrary() {
  const context = useContext(PrescriptionLibraryContext);

  if (!context) {
    throw new Error(
      "usePrescriptionLibrary must be used inside PrescriptionLibraryProvider"
    );
  }

  return context;
}
