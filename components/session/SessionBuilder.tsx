"use client";

import React, { useMemo, useState } from "react";
import { usePrescriptionLibrary } from "@/components/providers/PrescriptionLibraryProvider";
import { useSessionLibrary } from "@/components/providers/SessionLibraryProvider";
import type { TherapySession } from "@/lib/sessions/sessionTypes";

function createItemId() {
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function SessionBuilder() {
  const { allPrescriptions } = usePrescriptionLibrary();
  const { sessions, saveSession, deleteSession } = useSessionLibrary();

  const [sessionId, setSessionId] = useState(`session-${Date.now()}`);
  const [sessionName, setSessionName] = useState("Custom Therapy Session");
  const [selectedPrescriptionId, setSelectedPrescriptionId] = useState(
    allPrescriptions[0]?.id ?? ""
  );
  const [exerciseItems, setExerciseItems] = useState<TherapySession["exercises"]>([]);
  const [saveMessage, setSaveMessage] = useState("");

  const selectedPrescription = useMemo(() => {
    return allPrescriptions.find((item) => item.id === selectedPrescriptionId) ?? null;
  }, [allPrescriptions, selectedPrescriptionId]);

  function addExercise() {
    if (!selectedPrescription) return;

    setExerciseItems((prev) => [
      ...prev,
      {
        id: createItemId(),
        prescriptionId: selectedPrescription.id,
        displayName: selectedPrescription.name
      }
    ]);
  }

  function moveUp(index: number) {
    if (index === 0) return;

    setExerciseItems((prev) => {
      const copy = [...prev];
      [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]];
      return copy;
    });
  }

  function moveDown(index: number) {
    setExerciseItems((prev) => {
      if (index >= prev.length - 1) return prev;
      const copy = [...prev];
      [copy[index], copy[index + 1]] = [copy[index + 1], copy[index]];
      return copy;
    });
  }

  function removeExercise(id: string) {
    setExerciseItems((prev) => prev.filter((item) => item.id !== id));
  }

  function handleSaveSession() {
    if (!sessionName.trim() || exerciseItems.length === 0) return;

    const session: TherapySession = {
      id: sessionId,
      name: sessionName,
      exercises: exerciseItems,
      createdAt: Date.now()
    };

    saveSession(session);
    setSaveMessage(`Saved "${sessionName}"`);
    window.setTimeout(() => setSaveMessage(""), 2500);
  }

  function startNewSessionDraft() {
    setSessionId(`session-${Date.now()}`);
    setSessionName("Custom Therapy Session");
    setExerciseItems([]);
    setSaveMessage("");
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 20 }}>
      <section
        style={{
          background: "#1a2040",
          padding: 20,
          borderRadius: 12,
          display: "grid",
          gap: 14
        }}
      >
        <h2 style={{ margin: 0 }}>Session Builder</h2>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Session Name</span>
          <input
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "#121933",
              color: "white"
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Add Exercise</span>
          <select
            value={selectedPrescriptionId}
            onChange={(e) => setSelectedPrescriptionId(e.target.value)}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "#121933",
              color: "white"
            }}
          >
            {allPrescriptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={addExercise}
            style={{
              background: "#7cc6ff",
              color: "#08111f",
              fontWeight: 700,
              padding: "10px 14px",
              borderRadius: 10,
              border: "none",
              cursor: "pointer"
            }}
          >
            Add to Session
          </button>

          <button
            onClick={handleSaveSession}
            style={{
              background: "#9be7b0",
              color: "#08111f",
              fontWeight: 700,
              padding: "10px 14px",
              borderRadius: 10,
              border: "none",
              cursor: "pointer"
            }}
          >
            Save Session
          </button>

          <button
            onClick={startNewSessionDraft}
            style={{
              background: "rgba(255,255,255,0.12)",
              color: "white",
              padding: "10px 14px",
              borderRadius: 10,
              border: "none",
              cursor: "pointer"
            }}
          >
            New Draft
          </button>
        </div>

        {saveMessage && <p style={{ margin: 0, color: "#9be7b0" }}>{saveMessage}</p>}

        <div>
          <h3>Session Exercises</h3>

          {exerciseItems.length === 0 ? (
            <p style={{ color: "#aab6d3" }}>No exercises added yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {exerciseItems.map((item, index) => (
                <div
                  key={item.id}
                  style={{
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 10,
                    padding: 12,
                    background: "rgba(255,255,255,0.03)",
                    display: "grid",
                    gap: 10
                  }}
                >
                  <div>
                    <strong>
                      {index + 1}. {item.displayName}
                    </strong>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      onClick={() => moveUp(index)}
                      style={{
                        background: "rgba(255,255,255,0.12)",
                        color: "white",
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "none",
                        cursor: "pointer"
                      }}
                    >
                      Move Up
                    </button>
                    <button
                      onClick={() => moveDown(index)}
                      style={{
                        background: "rgba(255,255,255,0.12)",
                        color: "white",
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "none",
                        cursor: "pointer"
                      }}
                    >
                      Move Down
                    </button>
                    <button
                      onClick={() => removeExercise(item.id)}
                      style={{
                        background: "rgba(255,255,255,0.12)",
                        color: "white",
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "none",
                        cursor: "pointer"
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section
        style={{
          background: "#1a2040",
          padding: 20,
          borderRadius: 12,
          display: "grid",
          gap: 18
        }}
      >
        <div>
          <h2 style={{ marginTop: 0 }}>Saved Sessions</h2>

          {sessions.length === 0 ? (
            <p style={{ color: "#aab6d3" }}>No sessions saved yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {sessions.map((session) => (
                <div
                  key={session.id}
                  style={{
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 10,
                    padding: 12,
                    background: "rgba(255,255,255,0.03)"
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{session.name}</div>
                  <div style={{ fontSize: 13, color: "#aab6d3", marginTop: 4 }}>
                    {session.exercises.length} exercises
                  </div>

                  <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                    {session.exercises.map((item, index) => (
                      <div key={item.id} style={{ fontSize: 14 }}>
                        {index + 1}. {item.displayName}
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <button
                      onClick={() => deleteSession(session.id)}
                      style={{
                        background: "rgba(255,255,255,0.12)",
                        color: "white",
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "none",
                        cursor: "pointer"
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
