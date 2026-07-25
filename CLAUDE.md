# AI Image Tool - Claude Session Notes

## User ID for Supabase
```
user_3bde191f-98d8-4f2a-8235-b4497a7db1f5
```
To restore scenes in a new browser, run in console:
```javascript
localStorage.setItem('ai_tool_user_id', 'user_3bde191f-98d8-4f2a-8235-b4497a7db1f5')
```

---

## ⚠️ CRITICAL - MuseTalk Configuration

**MuseTalk requires the Supabase bucket to be PUBLIC.** Without this, you'll get the error:
```
Error: None should be a video file, an image file or a directory of images
```

### How to Make Supabase Bucket Public

1. Go to Supabase Dashboard: https://supabase.com/dashboard/project/ppadhpldhfcixcrvydwd
2. Click **Storage** in left sidebar
3. Click on bucket `ai-tool-images`
4. Click **Configuration** tab at the top
5. Under **Public bucket**, toggle it to **ON**
6. Click **Save**

**What this does:**
- Makes all files in the bucket publicly accessible via URLs
- Required because Replicate API needs to fetch avatar/audio files
- Signed URLs don't work with external APIs like Replicate

**Security note:**
- Files are only accessible if you know the exact path (UUID-based filenames)
- No directory listing is enabled
- Safe for this use case

### Verification

After making bucket public, test with:
```bash
curl -I https://ppadhpldhfcixcrvydwd.supabase.co/storage/v1/object/public/ai-tool-images/avatars/test.png
```
Should return `200 OK` (not `400 Bad Request`)

---

## Large Video Workflow (10+ minutes)

Browser memory crashes when processing videos longer than ~5 minutes. Use this FFmpeg-based workflow instead:

### Step 1: Generate Avatar Segments
- Use Hedra or similar to generate 90-second avatar video segments
- Save segments as `segment-1.mp4`, `segment-2.mp4`, etc.
- Store in `~/Downloads/avatar_segments_backup/`

### Step 2: Combine Segments with FFmpeg (NOT browser)
```bash
# Create file list
cd ~/Downloads/avatar_segments_backup
for f in segment-*.mp4; do echo "file '$f'" >> segments.txt; done

# Combine with audio resampling to 48000Hz
ffmpeg -f concat -safe 0 -i segments.txt -c:v copy \
  -af "aresample=48000:async=1" -c:a aac -b:a 192k \
  avatar_combined.mp4
```

### Step 3: Extract Audio for Tool Sync
```bash
ffmpeg -i avatar_combined.mp4 -vn -c:a libmp3lame -b:a 192k avatar_audio.mp3
```

### Step 4: Sync Captions in Browser Tool
1. Open tool in browser (Firefox recommended for large files)
2. Upload `avatar_audio.mp3` to the audio drop zone
3. Wait for "Audio decoded: XXX seconds" in console
4. Click "Sync to Audio" to align captions
5. Export background video with captions (this is lightweight - just images + text)

### Step 5: Composite Final Video with FFmpeg
```bash
ffmpeg -y -i background_with_captions.mp4 -i avatar_combined.mp4 \
  -filter_complex "[1:v]scale=350:-1[avatar];[0:v][avatar]overlay=x=W-w-50:y=H-h-50" \
  -map 0:v -map 1:a -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 192k \
  final_video.mp4
```

---

## Common Issues & Fixes

### Browser Crashes / Memory Issues
- Use Firefox instead of Chrome/Safari for large files
- Never export full video with avatar from browser - use FFmpeg
- Clear browser cache if seeing "Invalid URI" errors

### Audio Out of Sync
- Check all segments have same sample rate (48000Hz)
- Verify segment durations match expected times:
```bash
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 segment-X.mp4
```
- If segment is wrong duration, trim it:
```bash
ffmpeg -i segment-2.mp4 -t 90 -c copy segment-2-fixed.mp4
```

### Captions Behind/Ahead After X Minutes
- This means audio timing changed but captions weren't re-synced
- Re-upload the corrected audio to the tool
- Click "Force Re-Sync" to regenerate caption timings
- Re-export background with fresh captions

### Sample Rate Mismatch (Stuttering at segment boundaries)
- video-editor.js has automatic 48000Hz normalization (commit 508b94d)
- If still having issues, manually resample:
```bash
ffmpeg -i input.mp4 -af "aresample=48000" -c:v copy output.mp4
```

---

## File Locations

- Working directory: `~/Downloads/avatar_segments_backup/`
- Project code: `/Users/ruthlarbie/Projects/ai-image-tool/`
- **Local videos**: `public/videos/avatars/` (to avoid Supabase egress costs)
- **Local audio**: `public/audio/` (to avoid Supabase egress costs)
- **Supabase**: Only stores small images and database metadata (not videos/audio)

---

## Supabase Egress Fix (July 2026)

Videos and audio files are now stored **locally** instead of Supabase Storage to avoid egress quota issues.

### What changed:
- `server.js` saves videos to `public/videos/avatars/{userId}/{hash}.mp4`
- `server.js` saves audio to `public/audio/{filename}`
- URLs are now local paths like `/videos/avatars/user_xxx/abc123.mp4`
- Database still uses Supabase for metadata only (low bandwidth)

### If Supabase is blocked:
1. Go to supabase.com → Project → Settings → Billing
2. Either "Remove spend cap" or "Upgrade plan"
3. Quota resets monthly on free tier

### Storage locations:
| Content Type | Location | Why |
|-------------|----------|-----|
| Videos | Local (`public/videos/`) | Large files, high bandwidth |
| Audio | Local (`public/audio/`) | Large files, high bandwidth |
| Images | Supabase | Small files, acceptable egress |
| DB metadata | Supabase | Tiny data, negligible egress |

---

## Key Commands Reference

### Check video duration
```bash
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 video.mp4
```

### Check audio sample rate
```bash
ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate -of default=noprint_wrappers=1:nokey=1 video.mp4
```

### Trim video to exact duration
```bash
ffmpeg -i input.mp4 -t 639 -c copy output.mp4
```

### Convert audio format for browser compatibility
```bash
ffmpeg -i audio.mp3 -c:a aac -b:a 192k audio.m4a
```

---

## Storage Alert System (July 2026)

Proactive email alerts when local storage approaches limits - similar to how Supabase sends warning emails.

### Configuration
Add to `.env`:
```bash
RESEND_API_KEY=re_YOUR_API_KEY_HERE
ALERT_EMAIL=ruth@sayitandstop.com
```

### Thresholds
| Level | Threshold | Email Subject |
|-------|-----------|---------------|
| ⚠️ Warning | 70% | "Storage Warning: X% used" |
| 🚨 Critical | 90% | "CRITICAL: Storage at X%" |

### API Endpoints

**Check current usage:**
```bash
curl http://localhost:3500/api/usage
```
Returns storage status and triggers alerts if thresholds exceeded.

**Send test alert:**
```bash
curl -X POST http://localhost:3500/api/usage/test-alert
```
Sends a test email to verify Resend configuration.

**Reset alert state:**
```bash
curl -X POST http://localhost:3500/api/usage/reset-alerts
```
Allows warning/critical alerts to be sent again (normally only sent once per server session).

### How it works:
1. Server checks storage on startup
2. `GET /api/usage` checks and triggers alerts
3. Alerts sent once per server session to avoid spam
4. Emails sent from `alerts@foundercommandsystem.com` via Resend

### Storage limit:
Default: 10GB max local storage
Change `MAX_LOCAL_STORAGE_GB` in server.js if needed.

---

## Complete Video Production Workflow (UPDATED July 2026)

This is the **CORRECT** workflow for creating final videos with synced avatar, captions, and background scenes. Follow these exact parameters to avoid sync issues.

### Critical Parameters

**Video Dimensions:**
- Background/final video: 1920x1080 (16:9)
- Avatar source: 832x1088 (portrait, from MuseTalk/Hedra)
- Avatar overlay: 280px width (small circular overlay in bottom-right corner)
- Avatar position: Bottom-right corner, 50px margins
- Scene images: 1024x1024 (square)

**⚠️ CRITICAL - Background Processing:**
Scene images MUST use this EXACT FFmpeg filter to fill 1920x1080 frame:
```
scale=1920:1920,crop=1920:1080:0:0
```
- Scale square 1024x1024 to 1920x1920 (upscale)
- Crop TOP 1920x1080 from position x=0,y=0 (preserves character heads in upper portion)
- Removes 840px from BOTTOM of frame
- Characters are positioned in upper portion of square images (portrait composition)
- Top-crop (0:0) preserves heads, center-crop would cut them off
- NO blur, NO letterboxing, NO other techniques

**Caption Style:**
- Font: Georgia, 22px
- Position: Bottom center, 50px margin from bottom (MarginV: 50)
- Normal text: White (#FFFFFF)
- Highlighted word: Orange (#C8531B / &H001B53C8&)
- Format: ASS subtitles with karaoke word-by-word highlighting

### Step-by-Step Process

#### 1. Generate Avatar Segments
Use MuseTalk or Hedra to create 90-second segments:
- Max segment length: 90 seconds (to avoid memory issues)
- Audio format: AAC, 48000Hz sample rate
- Video format: H.264, portrait orientation
- Save as: `segment-1.mp4`, `segment-2.mp4`, etc.

#### 2. Combine Avatar Segments (CRITICAL: Re-encode, don't copy)
```bash
# Create concat list with FULL paths
cat > segments_list.txt << 'EOF'
file '/Users/ruthlarbie/Projects/ai-image-tool/public/videos/avatars/user_XXX/segment1.mp4'
file '/Users/ruthlarbie/Projects/ai-image-tool/public/videos/avatars/user_XXX/segment2.mp4'
file '/Users/ruthlarbie/Projects/ai-image-tool/public/videos/avatars/user_XXX/segment3.mp4'
EOF

# Combine segments with RE-ENCODING to fix timestamp discontinuities
ffmpeg -y -f concat -safe 0 -i segments_list.txt \
  -c:v libx264 -preset fast -crf 23 \
  -c:a aac -b:a 192k -ar 48000 \
  avatar_combined_fixed.mp4
```

**⚠️ IMPORTANT:** Use `-c:v libx264` (re-encode), NOT `-c copy` (stream copy). Re-encoding fixes non-monotonic DTS warnings that cause lip sync drift at segment boundaries.

#### 3. Extract Audio from Combined Avatar
```bash
# Extract audio for transcription (use THIS audio, not original segments)
ffmpeg -i avatar_combined_fixed.mp4 -vn -c:a libmp3lame -b:a 192k avatar_segments_audio.mp3
```

#### 4. Transcribe Audio with Word Timestamps
```python
#!/usr/bin/env python3
import os
import json
from openai import OpenAI

client = OpenAI(api_key=os.environ.get('OPENAI_API_KEY'))

# Transcribe the COMBINED audio (not original segments)
with open('avatar_segments_audio.mp3', 'rb') as audio_file:
    transcript = client.audio.transcriptions.create(
        model='whisper-1',
        file=audio_file,
        response_format='verbose_json',
        timestamp_granularities=['word']
    )

# Convert to dictionaries
words_list = []
for w in transcript.words:
    words_list.append({
        'word': w.word,
        'start': w.start,
        'end': w.end
    })

# Save transcript
output = {
    'text': transcript.text,
    'words': words_list
}

with open('segments_transcript.json', 'w') as f:
    json.dump(output, f, indent=2)

print(f'Transcribed {len(words_list)} words')
print(f'Duration: {words_list[-1]["end"]:.2f} seconds')
```

#### 5. Generate Karaoke Captions
```python
#!/usr/bin/env python3
import json

# Read transcript
with open('segments_transcript.json') as f:
    data = json.load(f)

words = data['words']

# Group into 4-word lines for context
lines = []
for i in range(0, len(words), 4):
    chunk = words[i:i+4]
    if chunk:
        lines.append(chunk)

# Create ASS file
with open('captions_segments_karaoke.ass', 'w') as f:
    # Header
    f.write("[Script Info]\n")
    f.write("ScriptType: v4.00+\n")
    f.write("PlayResX: 1920\n")
    f.write("PlayResY: 1080\n")
    f.write("ScaledBorderAndShadow: yes\n\n")

    # Style (Georgia 22px, white text, orange highlight)
    f.write("[V4+ Styles]\n")
    f.write("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n")
    f.write("Style: Normal,Georgia,22,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,50,1\n\n")

    # Events (word-by-word highlighting)
    f.write("[Events]\n")
    f.write("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")

    def format_time(seconds):
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        cs = int((seconds % 1) * 100)
        return f"{h}:{m:02d}:{s:02d}.{cs:02d}"

    for line in lines:
        for word_idx, word in enumerate(line):
            # Build line with only current word highlighted
            text_parts = []
            for i, w in enumerate(line):
                if i == word_idx:
                    # Orange highlight
                    text_parts.append(f"{{\\c&H001B53C8&}}{w['word']}{{\\c&H00FFFFFF&}}")
                else:
                    text_parts.append(w['word'])

            line_text = " ".join(text_parts)
            start = word['start']
            end = word['end']

            f.write(f"Dialogue: 0,{format_time(start)},{format_time(end)},Normal,,0,0,0,,{line_text}\n")

print("Karaoke captions created")
```

#### 6. Generate Fullscreen Background Video
Scene images are 1024x1024 (square) but video is 1920x1080 (16:9). Scale up and center-crop to fill frame without letterboxing:

```bash
#!/bin/bash
# Create background video that fills 1920x1080 without letterboxing
# AUTO-CLEANUP: Processes images in batches and cleans up temp files immediately

cd /Users/ruthlarbie/images

# Create temp directory for processed images
TEMP_DIR="/tmp/scenes_fullscreen_$$"
mkdir -p "$TEMP_DIR"

# Get sorted list of scene files
SCENES=$((ls scene_*.png 2>/dev/null; ls scene_*.jpg 2>/dev/null) | sort -V)

echo "Processing scenes and creating concat list..."

# Create concat file
CONCAT_FILE="$TEMP_DIR/concat.txt"
> "$CONCAT_FILE"

i=1
for scene in $SCENES; do
    OUTPUT="$TEMP_DIR/scene_$(printf '%03d' $i).png"

    # Scale to 1920x1920 (zoom in), then crop center 1920x1080
    # This fills the entire frame without letterboxing
    /opt/homebrew/Cellar/ffmpeg-full/8.1.2_1/bin/ffmpeg -y -i "$scene" \
        -vf "scale=1920:1920,crop=1920:1080" \
        "$OUTPUT" 2>/dev/null

    # Add to concat file
    echo "file '$OUTPUT'" >> "$CONCAT_FILE"
    echo "duration 6" >> "$CONCAT_FILE"

    echo "Processed scene $i: $scene"
    ((i++))
done

# Add last frame again (FFmpeg concat quirk)
LAST=$(ls "$TEMP_DIR"/scene_*.png | tail -1)
echo "file '$LAST'" >> "$CONCAT_FILE"

echo "Generating background video..."

# Generate background video
/opt/homebrew/Cellar/ffmpeg-full/8.1.2_1/bin/ffmpeg -y \
    -f concat -safe 0 -i "$CONCAT_FILE" \
    -r 24 -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p \
    /Users/ruthlarbie/background_fullscreen.mp4

echo "Background video created: background_fullscreen.mp4"

# AUTO-CLEANUP: Delete temp directory immediately
echo "Cleaning up temp files..."
rm -rf "$TEMP_DIR"
echo "Done! Temp files cleaned up."
```

**⚠️ CRITICAL:** This script auto-cleans temp files (~235MB saved). Background fills full frame without white side bars.

#### 7. Composite Final Video
```bash
ffmpeg -y \
  -i background_fullscreen.mp4 \
  -i avatar_combined_fixed.mp4 \
  -filter_complex "[1:v]scale=280:-1[avatar_scaled];[avatar_scaled]format=yuva420p,geq='lum=p(X,Y):a=if(gte(hypot(X-W/2,Y-H/2),W/2),0,255)'[avatar_circle];[0:v][avatar_circle]overlay=W-w-50:H-h-50,subtitles=captions_segments_karaoke.ass[v]" \
  -map "[v]" -map 1:a \
  -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 192k \
  -shortest final_video_complete.mp4
```

**Filter breakdown:**
1. `[1:v]scale=280:-1` - Scale avatar to 280px width (small circular overlay, unobtrusive)
2. `geq='lum=p(X,Y):a=if(gte(hypot(X-W/2,Y-H/2),W/2),0,255)'` - Apply circular mask
3. `overlay=W-w-50:H-h-50` - Position at bottom-right, 50px margins
4. `subtitles=captions_segments_karaoke.ass` - Add karaoke captions at bottom center

**Map audio from avatar:** `-map 1:a` uses audio from avatar_combined_fixed.mp4, ensuring perfect lip sync.

**Avatar sizing:** The 280px width creates a small, unobtrusive circular overlay in the bottom-right corner. The background character is the main focus, avatar is just for lip sync reference.

### Troubleshooting

**Letterboxing / white bars on sides:**
- **Cause:** Using `pad` filter adds colored bars on sides
- **Solution:** Use fullscreen script in Step 6: `scale=1920:1920,crop=1920:1080`
- This zooms in to fill frame, no white/cream bars

**Avatar too large/small:**
- Current setting: 280px width (small, unobtrusive corner overlay)
- To make smaller: 240px or 200px
- To make larger: 320px or 350px (may become too prominent)
- Adjust in final composite command: `[1:v]scale=XXX:-1`

**Captions out of sync:**
- Ensure you transcribed `avatar_segments_audio.mp3` (from combined avatar)
- Do NOT transcribe original segment audio files separately
- Check transcript timing matches final video duration

**Avatar lips out of sync:**
- Ensure avatar segments were re-encoded with `-c:v libx264`, not `-c copy`
- Re-encoding fixes timestamp discontinuities at segment boundaries
- Check avatar_combined_fixed.mp4 duration matches expected length

**Captions out of sync:**
- Ensure you transcribed `avatar_segments_audio.mp3` (from combined avatar)
- Do NOT transcribe original segment audio files separately

**Captions too large/small:**
- Adjust font size in ASS style: `Fontsize` parameter (default: 22)
- Adjust vertical position: `MarginV` parameter (default: 50 = 50px from bottom)

### File Checklist

Before starting final composite, verify:
- ✅ `avatar_combined_fixed.mp4` exists (re-encoded, not stream copied)
- ✅ `avatar_segments_audio.mp3` exists (extracted from combined avatar)
- ✅ `segments_transcript.json` exists (word-level timestamps)
- ✅ `captions_segments_karaoke.ass` exists (generated from transcript)
- ✅ `background_fullscreen.mp4` exists (1920x1080, fullscreen with no letterboxing)
- ✅ All files in same directory or use absolute paths

**Expected final output:**
- Filename: `final_video_complete.mp4`
- Duration: ~506-510 seconds (8:26-8:30)
- Size: ~45-50 MB
- Resolution: 1920x1080
- Features: Fullscreen background scenes, 280px circular avatar (bottom-right), karaoke captions (bottom-center)

### Disk Space Management

**⚠️ CRITICAL:** Video production uses significant disk space. Follow these practices:

**Auto-cleanup in scripts:**
- All background processing scripts now auto-delete temp files after completion
- Temp directories cleaned up automatically (saves ~235MB per run)

**File sizes:**
- `avatar_combined_fixed.mp4`: ~180MB (keep - needed for regeneration)
- `background_fullscreen.mp4`: ~20MB (can delete after final composite)
- `final_video_complete.mp4`: ~47MB (keep - this is your final output)
- Temp directories: ~235MB (auto-cleaned)

**Cleanup script:**
```bash
# Run this to free space after video creation
chmod +x cleanup_video_files.sh
./cleanup_video_files.sh
```

**Manual cleanup:**
```bash
# Delete temp directories
rm -rf /tmp/scenes_*

# Delete intermediate backgrounds (after final composite)
rm -f background_fullscreen.mp4
```

**Files to keep:**
- ✅ `final_video_complete.mp4` - your finished video
- ✅ `avatar_combined_fixed.mp4` - if you need to remake video
- ✅ `captions_segments_karaoke.ass` - caption file
- ✅ `segments_transcript.json` - transcript with timestamps

---

## Avatar Description & Brand Rules

Use these when generating images with the avatar character or applying brand styling.

### Avatar Character Description

The character has long, flowing hair with deep, lustrous waves that cascade over her shoulders, exhibiting a rich, dark brown hue. Her complexion is warm and radiant, a deep caramel brown that glows with a healthy sheen. Her eyes are large and expressive, a deep amber brown that sparkles with intelligence and warmth, framed by thick, curled eyelashes that accentuate their almond shape. Her face is oval-shaped with high cheekbones and a gently rounded chin, giving her a look of approachable elegance. She wears a bright, confident smile, highlighted by full lips with a glossy finish. Dressed in a striking red top with decorative ruffles, she exudes a vibrant and confident style, further accentuated by a collection of motivational decor in the background, suggesting a personality devoted to inspiration and empowerment. Her overall aesthetic blends warmth, charisma, and a modern, chic style.

### Brand Rules

**Mood and Atmosphere:**
- Warm, soft, nurturing, feminine, heart-centered, empowering

**Lighting Style:**
- Soft golden light, warm tones, cozy atmosphere

**Color Palette:**
- Soft pinks, warm corals, muted purples, cream, gold accents

**NEVER Include (Avoid):**
- Corporate blue
- Harsh lighting
- Masculine boardroom vibes
- Cold/sterile environments
- Aggressive imagery
