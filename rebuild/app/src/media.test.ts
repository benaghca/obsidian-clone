import { describe, expect, it } from "vitest";
import { MEDIA_PLAY_FAIL, mediaBytesMatch, mediaFailText, mediaKind, mediaMime } from "./media";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("media files", () => {
  it("names audio, video, and PDF from the extension", () => {
    expect(mediaKind("clip.mp3")).toBe("audio");
    expect(mediaKind("Voice.M4A")).toBe("audio");
    expect(mediaKind("song.flac")).toBe("audio");
    expect(mediaKind("movie.mp4")).toBe("video");
    expect(mediaKind("movie.webm")).toBe("video");
    expect(mediaKind("Docs/Lease.PDF")).toBe("pdf");
    expect(mediaKind("Note.md")).toBeNull();
    expect(mediaKind("pic.png")).toBeNull();
    expect(mediaKind("run.sh")).toBeNull();
    expect(mediaKind("file.mp3.md")).toBeNull();
    expect(mediaKind("Board.canvas")).toBeNull();
  });

  it("picks a blob type that is not a script", () => {
    expect(mediaMime("clip.mp3")).toBe("audio/mpeg");
    expect(mediaMime("movie.mov")).toBe("video/mp4");
    expect(mediaMime("movie.webm")).toBe("video/webm");
    expect(mediaMime("Docs/Lease.PDF")).toBe("application/pdf");
    expect(mediaMime("run.sh")).toBe("application/octet-stream");
    expect(mediaMime("page.html")).toBe("application/octet-stream");
  });

  it("accepts a real header and refuses a script or the wrong container", () => {
    expect(mediaBytesMatch("a.pdf", bytes("%PDF-1.4"))).toBe(true);
    expect(mediaBytesMatch("a.PDF", bytes("%PDF"))).toBe(true);
    expect(mediaBytesMatch("clip.mp3", bytes("ID3"))).toBe(true);
    expect(mediaBytesMatch("clip.mp3", new Uint8Array([0xff, 0xfb, 0x90]))).toBe(true);
    expect(mediaBytesMatch("sound.wav", bytes("RIFF\0\0\0\0WAVE"))).toBe(true);
    expect(mediaBytesMatch("song.ogg", bytes("OggS"))).toBe(true);
    expect(mediaBytesMatch("song.flac", bytes("fLaC"))).toBe(true);
    expect(mediaBytesMatch("voice.aac", new Uint8Array([0xff, 0xf1]))).toBe(true);
    expect(mediaBytesMatch("movie.mp4", bytes("\0\0\0\x18ftypisom"))).toBe(true);
    expect(mediaBytesMatch("movie.mov", bytes("\0\0\0\0moov"))).toBe(true);
    expect(mediaBytesMatch("movie.webm", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBe(true);
    expect(mediaBytesMatch("movie.ogv", bytes("OggS"))).toBe(true);

    expect(mediaBytesMatch("clip.mp3", bytes("<script>alert(1)</script>"))).toBe(false);
    expect(mediaBytesMatch("clip.mp4", bytes("#!/bin/sh\n"))).toBe(false);
    expect(mediaBytesMatch("a.pdf", new Uint8Array([0xef, 0xbb, 0xbf, 0x0a, 0x20, 0x3c]))).toBe(false);
    expect(mediaBytesMatch("a.pdf", new Uint8Array())).toBe(false);
    expect(mediaBytesMatch("movie.mp4", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBe(false);
    expect(mediaBytesMatch("sound.wav", bytes("RIFF\0\0\0\0AVI "))).toBe(false);
    expect(mediaBytesMatch("Note.md", bytes("%PDF"))).toBe(false);
    expect(mediaBytesMatch("run.sh", bytes("ID3"))).toBe(false);
  });

  it("says when a file is too large, and otherwise that it cannot be shown", () => {
    expect(mediaFailText("too large to show: movie.mp4", "video")).toBe("Too large to show.");
    expect(mediaFailText(new Error("too large to show: a.pdf"), "pdf")).toBe("Too large to show.");
    expect(mediaFailText("not a media file: a.pdf", "pdf")).toBe("This PDF can't be shown.");
    expect(mediaFailText("not a media file: clip.mp3", "audio")).toBe("This file can't be shown.");
    expect(MEDIA_PLAY_FAIL).toBe("This file can't be played here.");
  });
});
