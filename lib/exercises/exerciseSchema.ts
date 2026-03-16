import { ExerciseDefinition } from "@/lib/types/exercise"

export function getExercise(

exercises:ExerciseDefinition[],

id:string

){

return exercises.find(e=>e.id===id)

}
