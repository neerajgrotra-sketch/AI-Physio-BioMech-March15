export type PoseLandmark = {
x:number
y:number
z?:number
score?:number
}

export type PoseFrame = {

timestamp:number

landmarks:Record<string,PoseLandmark>

personDetected:boolean

}
