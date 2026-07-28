"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import styles from "./DatasetLoader.module.css";

/**
 * Drop target for an operational log.
 *
 * The whole window is the drop zone once a drag starts — aiming at a small
 * rectangle is the part of file upload everyone hates. The file is read with
 * FileReader and analysed in the page; nothing is sent anywhere, which is the
 * only reason showing a corporate log here is defensible at all.
 */

export interface DatasetLoaderProps {
  onFile: (contents: string, fileName: string) => void;
  onError: (message: string) => void;
  busy?: boolean;
}

/** Large enough for a year of traffic, small enough not to hang the tab. */
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const ACCEPTED = ".jsonl,.ndjson,.json,.log,.txt";

export function DatasetLoader({ onFile, onError, busy }: DatasetLoaderProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const read = useCallback(
    (file: File) => {
      if (file.size > MAX_FILE_BYTES) {
        onError(
          `Файл больше ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} МБ — браузер такой не потянет.`,
        );
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => onError("Файл не прочитался.");
      reader.onload = () => onFile(String(reader.result ?? ""), file.name);
      reader.readAsText(file);
    },
    [onError, onFile],
  );

  useEffect(() => {
    // Counting enter/leave events is the only reliable way to know the pointer
    // has really left the window: every child element fires its own leave.
    let depth = 0;

    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) {
        return;
      }
      depth += 1;
      setDragging(true);
    };
    const onDragLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        setDragging(false);
      }
    };
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
      }
    };
    const onDrop = (event: DragEvent) => {
      depth = 0;
      setDragging(false);

      const file = event.dataTransfer?.files?.[0];
      if (!file) {
        return;
      }

      event.preventDefault();
      read(file);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);

    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [read]);

  return (
    <>
      <button
        className={styles.trigger}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        <UploadIcon />
        {busy ? "Считаем…" : "Загрузить лог"}
      </button>

      <input
        accept={ACCEPTED}
        className={styles.input}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            read(file);
          }
          // Reset so choosing the same file twice fires onChange again.
          event.target.value = "";
        }}
        ref={inputRef}
        type="file"
      />

      {dragging && (
        <div className={styles.overlay}>
          <div className={styles.overlayCard}>
            <strong>Отпустите файл</strong>
            <span>JSONL или JSON-массив operational events</span>
            <small>Файл не загружается на сервер — расчёт идёт в браузере</small>
          </div>
        </div>
      )}
    </>
  );
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M10 13V3M6.5 6.5 10 3l3.5 3.5M3 13v3.5h14V13" />
    </svg>
  );
}
