import SessionRunner from "@/components/session/SessionRunner"

export default function Page() {
  return (
    <main style={{padding:40}}>
      <h1>AI Physio BioMech Prototype</h1>
      <p>Movement intelligence platform for physiotherapy.</p>

      <SessionRunner/>
    </main>
  )
}
