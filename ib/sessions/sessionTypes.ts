export type SessionExerciseItem = {
  id: string;
  prescriptionId: string;
  displayName: string;
};

export type TherapySession = {
  id: string;
  name: string;
  exercises: SessionExerciseItem[];
  createdAt: number;
};
