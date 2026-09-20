import fs from 'fs';
const lines = fs.readFileSync("C:\\Users\\HP\\.gemini\\antigravity-ide\\brain\\fcb8346c-93bf-4257-aad0-0440c6fcf1f2\\.system_generated\\logs\\transcript_full.jsonl", 'utf8').split('\n');
for (const line of lines) {
  if (!line) continue;
  try {
    const obj = JSON.parse(line);
    if (obj.step_index === 19 && obj.type === 'VIEW_FILE' && obj.content) {
      let text = obj.content;
      let parts = text.split('\n');
      let codeLines = [];
      let startRecording = false;
      for (let p of parts) {
        if (p.match(/^\d+:/)) {
          startRecording = true;
          codeLines.push(p.replace(/^\d+:\s?/, ''));
        } else if (startRecording) {
          if (p.includes('The above content shows the entire')) break;
        }
      }
      fs.writeFileSync('app/theatre.tsx', codeLines.join('\n'));
      console.log('Restored app/theatre.tsx');
      break;
    }
  } catch (e) {
    console.error(e);
  }
}
