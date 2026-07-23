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
