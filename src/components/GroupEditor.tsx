"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useRadioStore } from "@/lib/store";

/**
 * GroupEditor — modal replacement for PresetBar's StubModal.
 *
 * Two modes:
 *   - { kind: "edit", groupId }  → rename / reorder / delete
 *   - { kind: "create" }         → create a new band
 *
 * Styling mirrors SearchOverlay so the modal family reads as one system.
 */

export type GroupEditorMode =
  | { kind: "edit"; groupId: string }
  | { kind: "create" };

export default function GroupEditor({
  mode,
  onClose,
}: {
  mode: GroupEditorMode;
  onClose: () => void;
}) {
  // ESC closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={mode.kind === "create" ? "New group" : "Edit group"}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/75" aria-hidden />
      <div
        className="relative w-full max-w-[460px] mt-10 rounded-[18px] p-3 surface-brass shadow-brass-ring"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-[12px] bg-walnut-900/90 text-ivory-soft">
          {mode.kind === "create" ? (
            <CreatePanel onClose={onClose} />
          ) : (
            <EditPanel groupId={mode.groupId} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- Create panel ----------------

function CreatePanel({ onClose }: { onClose: () => void }) {
  const createGroup = useRadioStore((s) => s.createGroup);
  const setActiveGroup = useRadioStore((s) => s.setActiveGroup);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const trimmed = name.trim();
  const canCreate = trimmed.length > 0;

  function handleCreate() {
    if (!canCreate) return;
    const id = createGroup(trimmed);
    // Jump to the newly created band so the user can start populating it.
    setActiveGroup(id);
    onClose();
  }

  return (
    <div className="px-4 py-4">
      <Header title="New Band" onClose={onClose} />
      <label className="block mt-3 text-[11px] tracking-[0.18em] uppercase text-brass-300/80">
        Name
      </label>
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleCreate();
        }}
        placeholder="e.g. Late Night, Indie, Classical"
        className="mt-1 w-full rounded-md px-3 py-2 text-sm font-sans bg-walnut-800 border border-walnut-600 text-ivory-dial placeholder:text-ivory-soft/40 focus:outline-none focus:border-brass-500"
        autoComplete="off"
        spellCheck={false}
      />
      <div className="mt-4 flex justify-end gap-2">
        <GhostButton onClick={onClose}>Cancel</GhostButton>
        <BrassButton onClick={handleCreate} disabled={!canCreate}>
          Create
        </BrassButton>
      </div>
    </div>
  );
}

// ---------------- Edit panel ----------------

function EditPanel({
  groupId,
  onClose,
}: {
  groupId: string;
  onClose: () => void;
}) {
  const group = useRadioStore((s) => s.groups.find((g) => g.id === groupId));
  const sortedGroups = useRadioStore(
    useShallow((s) => [...s.groups].sort((a, b) => a.position - b.position)),
  );
  const memberCount = useRadioStore(
    (s) => s.memberships.filter((m) => m.groupId === groupId).length,
  );
  const canDelete = useRadioStore((s) => s.groups.length > 1);

  const renameGroup = useRadioStore((s) => s.renameGroup);
  const moveGroup = useRadioStore((s) => s.moveGroup);
  const deleteGroup = useRadioStore((s) => s.deleteGroup);

  const [name, setName] = useState(group?.name ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // If the group vanishes under us (e.g. deleted from elsewhere), close.
  useEffect(() => {
    if (!group) onClose();
  }, [group, onClose]);

  const idx = useMemo(
    () => sortedGroups.findIndex((g) => g.id === groupId),
    [sortedGroups, groupId],
  );
  const canMoveUp = idx > 0;
  const canMoveDown = idx >= 0 && idx < sortedGroups.length - 1;

  if (!group) return null;

  const trimmed = name.trim();
  const nameChanged = trimmed && trimmed !== group.name;

  function handleSave() {
    if (!nameChanged) {
      onClose();
      return;
    }
    renameGroup(groupId, trimmed);
    onClose();
  }

  function handleDelete() {
    if (memberCount > 0 && !confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    deleteGroup(groupId);
    onClose();
  }

  return (
    <div className="px-4 py-4">
      <Header title={`Edit "${group.name}"`} onClose={onClose} />

      <label className="block mt-3 text-[11px] tracking-[0.18em] uppercase text-brass-300/80">
        Name
      </label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
        }}
        className="mt-1 w-full rounded-md px-3 py-2 text-sm font-sans bg-walnut-800 border border-walnut-600 text-ivory-dial focus:outline-none focus:border-brass-500"
        autoComplete="off"
        spellCheck={false}
      />

      <div className="mt-4 flex items-center justify-between">
        <div className="text-[11px] tracking-[0.1em] uppercase text-ivory-soft/60">
          {memberCount} station{memberCount === 1 ? "" : "s"}
        </div>
        <div className="flex gap-2">
          <GhostButton
            onClick={() => moveGroup(groupId, "up")}
            disabled={!canMoveUp}
            title="Move up"
          >
            ↑
          </GhostButton>
          <GhostButton
            onClick={() => moveGroup(groupId, "down")}
            disabled={!canMoveDown}
            title="Move down"
          >
            ↓
          </GhostButton>
        </div>
      </div>

      {/* Danger zone */}
      <div className="mt-5 pt-3 border-t border-walnut-700/60">
        {!confirmingDelete ? (
          <div className="flex items-center justify-between">
            <div className="text-[11px] tracking-[0.1em] uppercase text-ivory-soft/60">
              {canDelete ? "Remove this band" : "Last band cannot be deleted"}
            </div>
            <DangerButton onClick={handleDelete} disabled={!canDelete}>
              Delete
            </DangerButton>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-amber-warm">
              Remove “{group.name}” and its {memberCount} station
              {memberCount === 1 ? "" : "s"}?
            </div>
            <div className="flex gap-2 shrink-0">
              <GhostButton onClick={() => setConfirmingDelete(false)}>
                Keep
              </GhostButton>
              <DangerButton onClick={handleDelete}>Confirm</DangerButton>
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <GhostButton onClick={onClose}>Cancel</GhostButton>
        <BrassButton onClick={handleSave}>
          {nameChanged ? "Save" : "Done"}
        </BrassButton>
      </div>
    </div>
  );
}

// ---------------- Shared chrome ----------------

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-display uppercase tracking-[0.22em] text-sm text-brass-300 truncate pr-3">
        {title}
      </h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-transform active:translate-y-[1px]"
        style={{
          background:
            "radial-gradient(circle at 30% 25%, #f0d9a8 0%, #b48a49 55%, #5a3f1a 100%)",
          boxShadow:
            "inset 0 1px 2px rgba(255,240,200,0.6), inset 0 -2px 3px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
          color: "#1a120a",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <line x1="2" y1="2" x2="12" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <line x1="12" y1="2" x2="2" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function BrassButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="font-display uppercase tracking-[0.2em] text-[11px] rounded-md px-3 py-1.5 transition-transform active:translate-y-[1px] disabled:opacity-50 disabled:cursor-default disabled:active:translate-y-0"
      style={{
        color: "#1a120a",
        background:
          "radial-gradient(circle at 30% 20%, #f0d9a8 0%, #b48a49 70%, #8a6a32 100%)",
        border: "1px solid rgba(0,0,0,0.7)",
        boxShadow:
          "inset 0 1px 2px rgba(255,240,200,0.6), 0 2px 3px rgba(0,0,0,0.5)",
      }}
    >
      {children}
    </button>
  );
}

function GhostButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="font-display uppercase tracking-[0.2em] text-[11px] rounded-md px-3 py-1.5 transition-transform active:translate-y-[1px] disabled:opacity-40 disabled:cursor-default disabled:active:translate-y-0"
      style={{
        color: "#e8d6a8",
        background: "linear-gradient(180deg, #2a1810 0%, #120a04 100%)",
        border: "1px solid rgba(0,0,0,0.7)",
        boxShadow:
          "inset 0 1px 1px rgba(255,200,140,0.15), inset 0 -2px 3px rgba(0,0,0,0.6), 0 2px 3px rgba(0,0,0,0.4)",
      }}
    >
      {children}
    </button>
  );
}

function DangerButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="font-display uppercase tracking-[0.2em] text-[11px] rounded-md px-3 py-1.5 transition-transform active:translate-y-[1px] disabled:opacity-40 disabled:cursor-default disabled:active:translate-y-0"
      style={{
        color: "#f3e5c4",
        background:
          "linear-gradient(180deg, #6b2319 0%, #3a1108 100%)",
        border: "1px solid rgba(0,0,0,0.7)",
        boxShadow:
          "inset 0 1px 1px rgba(255,180,120,0.25), inset 0 -2px 3px rgba(0,0,0,0.6), 0 2px 3px rgba(0,0,0,0.5)",
      }}
    >
      {children}
    </button>
  );
}
