import { expect, test } from "vitest";
import { attachmentDir, attachmentName, attachmentPaths, embedFor, pastedImageName, uniquePath } from "./attachments";

const at = new Date(2026, 9, 23, 20, 15, 0);

test("attachments go where Obsidian's attachment folder setting says", () => {
  expect(attachmentDir("Notes/A.md", "/")).toBe("");
  expect(attachmentDir("Notes/A.md", "")).toBe("");
  expect(attachmentDir("Notes/A.md", "./")).toBe("Notes");
  expect(attachmentDir("A.md", "./")).toBe("");
  expect(attachmentDir("Notes/A.md", "./shots")).toBe("Notes/shots");
  expect(attachmentDir("A.md", "./shots")).toBe("shots");
  expect(attachmentDir("Notes/A.md", "Attachments")).toBe("Attachments");
  expect(attachmentDir("Notes/A.md", "/Attachments/")).toBe("Attachments");
  expect(attachmentDir("Notes/A.md", "../secret")).toBe("");
  expect(attachmentDir("Notes/A.md", "a/../../b")).toBe("");
});

test("clipboard images are stamped, named files keep their names, and clashes gain a number", () => {
  expect(pastedImageName(at, "png")).toBe("Pasted image 20261023201500.png");
  expect(attachmentName({ name: "image.png", type: "image/png" }, at)).toBe("Pasted image 20261023201500.png");
  expect(attachmentName({ name: "", type: "image/jpeg" }, at)).toBe("Pasted image 20261023201500.jpg");
  expect(attachmentName({ name: "diagram.png", type: "image/png" }, at)).toBe("diagram.png");
  expect(attachmentName({ name: "image.png", type: "image/png" }, at, false)).toBe("image.png");
  expect(attachmentPaths("Notes/A.md", "/", [{ name: "image.png", type: "image/png" }], [], at, false)).toEqual(["image.png"]);
  expect(attachmentName({ name: "C:\\Users\\a\\report.pdf", type: "application/pdf" }, at)).toBe("report.pdf");
  expect(uniquePath("", "Pasted image 20261023201500.png", ["Pasted image 20261023201500.png"])).toBe("Pasted image 20261023201500 1.png");
  expect(uniquePath("Attachments", "photo.png", ["attachments/photo.png"])).toBe("Attachments/photo 1.png");
  expect(attachmentPaths("Notes/A.md", "/", [
    { name: "image.png", type: "image/png" },
    { name: "image.png", type: "image/png" },
    { name: "diagram.png", type: "image/png" },
  ], ["diagram.png"], at)).toEqual([
    "Pasted image 20261023201500.png",
    "Pasted image 20261023201500 1.png",
    "diagram 1.png",
  ]);
});

test("the embed follows the link settings", () => {
  const files = [
    { name: "photo.png", path: "A/photo.png" },
    { name: "photo.png", path: "B/photo.png" },
    { name: "Note", path: "Note.md" },
  ];
  expect(embedFor("Pasted image 20261023201500.png", "Notes/A.md", files, { format: "shortest", wikilinks: true }))
    .toBe("![[Pasted image 20261023201500.png]]");
  expect(embedFor("B/photo.png", "Notes/A.md", files, { format: "shortest", wikilinks: true })).toBe("![[B/photo.png]]");
  expect(embedFor("A/photo.png", "Notes/A.md", files, { format: "shortest", wikilinks: false })).toBe("![photo.png](A/photo.png)");
});
