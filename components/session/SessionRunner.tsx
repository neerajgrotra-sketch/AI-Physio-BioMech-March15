"use client"

import { EXERCISE_LIBRARY } from "@/lib/exercises/exerciseLibrary"

export default function SessionRunner(){

const exercise = EXERCISE_LIBRARY[0]

return(

<div style={{marginTop:30}}>

<h2>Session Runner</h2>

<div style={{background:"#1a2040",padding:20,borderRadius:10}}>

<h3>Current Exercise</h3>

<p>{exercise.name}</p>

<p>{exercise.description}</p>

<button>Start Session</button>

</div>

</div>

)

}
