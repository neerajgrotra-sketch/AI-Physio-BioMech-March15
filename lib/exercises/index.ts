import { rightArmRaisePrescription } from "@/lib/exercises/definitions/rightArmRaise";
import { leftArmRaisePrescription } from "@/lib/exercises/definitions/leftArmRaise";
import { bothArmRaisePrescription } from "@/lib/exercises/definitions/bothArmRaise";
import { sitToStandPrescription } from "@/lib/exercises/definitions/sitToStand";

export const EXERCISE_PRESCRIPTIONS = [
  rightArmRaisePrescription,
  leftArmRaisePrescription,
  bothArmRaisePrescription,
  sitToStandPrescription
];

export const ACTIVE_EXERCISE_PRESCRIPTIONS = EXERCISE_PRESCRIPTIONS.filter(
  (item) => item.runtimeStatus === "active"
);

export {
  rightArmRaisePrescription,
  leftArmRaisePrescription,
  bothArmRaisePrescription,
  sitToStandPrescription
};
