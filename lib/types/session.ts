import type { ExercisePrescription, MovementPhase } from "./exercise";

export type SessionExerciseState = {
  exerciseId: string;
  repCount: number;
  currentPhase: MovementPhase;
  isComplete: boolean;
};

export type SessionState = {
  started: boolean;
  currentExerciseIndex: number;
  exercises: ExercisePrescription[];
  exerciseState: SessionExerciseState;
};
