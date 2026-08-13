#!/bin/bash
# Ken Burns A/B Shot Video Generator
# Each scene becomes TWO shots: full frame (A) + cropped focal point (B)
# Creates 1920x1080 background video with ~2x visual changes
#
# Usage: ./create_kenburns_ab_shots.sh [input_dir] [output_file] [scene_duration]
#
# Optional: place a config file at input_dir/scene_config.json for per-scene settings

set -e

# Configuration
INPUT_DIR="${1:-/Users/ruthlarbie/images}"
OUTPUT_FILE="${2:-/Users/ruthlarbie/background_kenburns_ab.mp4}"
SCENE_DURATION="${3:-15}"  # Total seconds per scene (A + B combined)
FPS=24
WIDTH=1920
HEIGHT=1080

# A/B Split defaults (can be overridden per-scene)
DEFAULT_SPLIT_RATIO=0.5  # 50/50 split between A and B shots

# Crop settings for B-shot (as percentage of frame)
B_CROP_SCALE=0.65  # 65% of original = tighter crop
B_CROP_FOCUS="upper-center"  # Default: face region

# Motion patterns - we cycle through these
MOTIONS_A=("push-in" "drift-left" "pull-back" "drift-right")
MOTIONS_B=("drift-right" "push-in" "drift-left" "pull-back")  # Offset from A

# Temp directory
TEMP_DIR="/tmp/kenburns_ab_$$"
mkdir -p "$TEMP_DIR"

cleanup() {
    echo "Cleaning up temp files..."
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

echo "========================================"
echo "Ken Burns A/B Shot Video Generator"
echo "========================================"
echo "Input directory: $INPUT_DIR"
echo "Output file: $OUTPUT_FILE"
echo "Scene duration: ${SCENE_DURATION}s (split into A + B shots)"
echo "Resolution: ${WIDTH}x${HEIGHT}"
echo "========================================"

# Check for per-scene config
CONFIG_FILE="$INPUT_DIR/scene_config.json"
if [ -f "$CONFIG_FILE" ]; then
    echo "Found scene config: $CONFIG_FILE"
    HAS_CONFIG=true
else
    echo "No scene_config.json found - using defaults"
    HAS_CONFIG=false
fi

# Find scene images
cd "$INPUT_DIR"
SCENES=$(ls -1 scene_*.png scene_*.jpg 2>/dev/null | sort -V)
SCENE_COUNT=$(echo "$SCENES" | grep -c . || echo 0)

if [ "$SCENE_COUNT" -eq 0 ]; then
    echo "ERROR: No scene images found in $INPUT_DIR"
    exit 1
fi

echo "Found $SCENE_COUNT scenes → $((SCENE_COUNT * 2)) visual shots"
echo ""

# ============================================================
# ZOOMPAN FILTER GENERATORS
# ============================================================

# Shot A: Full frame with motion
# Parameters: frames, motion_type
generate_filter_a() {
    local frames=$1
    local motion=$2

    case $motion in
        "push-in")
            # Slow zoom in: 1.0 → 1.08, centered
            echo "scale=8000:-1,zoompan=z='1.0+on/${frames}*0.08':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}"
            ;;
        "pull-back")
            # Slow zoom out: 1.08 → 1.0, centered
            echo "scale=8000:-1,zoompan=z='1.08-on/${frames}*0.08':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}"
            ;;
        "drift-left")
            # Pan from right to left with slight zoom
            echo "scale=8000:-1,zoompan=z='1.05':x='iw/2-(iw/zoom/2)+(iw/zoom*0.04)-(on/${frames})*(iw/zoom*0.08)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}"
            ;;
        "drift-right")
            # Pan from left to right with slight zoom
            echo "scale=8000:-1,zoompan=z='1.05':x='iw/2-(iw/zoom/2)-(iw/zoom*0.04)+(on/${frames})*(iw/zoom*0.08)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}"
            ;;
    esac
}

# Shot B: Cropped region with motion
# Parameters: frames, motion_type, crop_focus
# The crop is done by adjusting zoompan's initial zoom and position
generate_filter_b() {
    local frames=$1
    local motion=$2
    local focus=$3

    # Base zoom for crop (1/0.65 ≈ 1.54 to simulate 65% crop)
    local base_zoom=1.54

    # Calculate focus position offsets
    # These shift the crop region within the zoomed view
    local focus_x="0"
    local focus_y="-ih*0.08"  # Default: upper region (face)

    case $focus in
        "upper-center"|"face")
            focus_y="-ih*0.10"  # Shift up to capture face
            focus_x="0"
            ;;
        "center")
            focus_y="0"
            focus_x="0"
            ;;
        "left")
            focus_y="0"
            focus_x="-iw*0.10"
            ;;
        "right")
            focus_y="0"
            focus_x="iw*0.10"
            ;;
        "upper-left")
            focus_y="-ih*0.10"
            focus_x="-iw*0.10"
            ;;
        "upper-right")
            focus_y="-ih*0.10"
            focus_x="iw*0.10"
            ;;
        "lower-center")
            focus_y="ih*0.05"  # Slight shift down, but not too much (captions!)
            focus_x="0"
            ;;
    esac

    case $motion in
        "push-in")
            # Zoom in more from already cropped state
            echo "scale=8000:-1,zoompan=z='${base_zoom}+on/${frames}*0.08':x='iw/2-(iw/zoom/2)+(${focus_x})':y='ih/2-(ih/zoom/2)+(${focus_y})':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}"
            ;;
        "pull-back")
            # Slight pull back within cropped region
            local end_zoom=$(echo "$base_zoom - 0.06" | bc)
            echo "scale=8000:-1,zoompan=z='${base_zoom}-on/${frames}*0.06':x='iw/2-(iw/zoom/2)+(${focus_x})':y='ih/2-(ih/zoom/2)+(${focus_y})':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}"
            ;;
        "drift-left")
            echo "scale=8000:-1,zoompan=z='${base_zoom}':x='iw/2-(iw/zoom/2)+(${focus_x})+(iw/zoom*0.03)-(on/${frames})*(iw/zoom*0.06)':y='ih/2-(ih/zoom/2)+(${focus_y})':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}"
            ;;
        "drift-right")
            echo "scale=8000:-1,zoompan=z='${base_zoom}':x='iw/2-(iw/zoom/2)+(${focus_x})-(iw/zoom*0.03)+(on/${frames})*(iw/zoom*0.06)':y='ih/2-(ih/zoom/2)+(${focus_y})':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}"
            ;;
    esac
}

# ============================================================
# READ PER-SCENE CONFIG (if exists)
# ============================================================

get_scene_config() {
    local scene_num=$1
    local field=$2
    local default=$3

    if [ "$HAS_CONFIG" = true ] && command -v jq &> /dev/null; then
        local value=$(jq -r ".scene_${scene_num}.${field} // \"${default}\"" "$CONFIG_FILE" 2>/dev/null)
        if [ "$value" != "null" ] && [ -n "$value" ]; then
            echo "$value"
            return
        fi
    fi
    echo "$default"
}

# ============================================================
# PROCESS SCENES
# ============================================================

CONCAT_FILE="$TEMP_DIR/concat.txt"
> "$CONCAT_FILE"

motion_idx=0
scene_num=1

for scene in $SCENES; do
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Scene $scene_num/$SCENE_COUNT: $scene"

    # Get per-scene config or defaults
    TOTAL_DUR=$(get_scene_config $scene_num "duration" $SCENE_DURATION)
    SPLIT=$(get_scene_config $scene_num "split" $DEFAULT_SPLIT_RATIO)
    MOTION_A=$(get_scene_config $scene_num "motion_a" "${MOTIONS_A[$motion_idx]}")
    MOTION_B=$(get_scene_config $scene_num "motion_b" "${MOTIONS_B[$motion_idx]}")
    CROP_FOCUS=$(get_scene_config $scene_num "crop_focus" "$B_CROP_FOCUS")

    # Calculate durations
    DUR_A=$(echo "$TOTAL_DUR * $SPLIT" | bc)
    DUR_B=$(echo "$TOTAL_DUR - $DUR_A" | bc)
    FRAMES_A=$(echo "$DUR_A * $FPS" | bc | cut -d. -f1)
    FRAMES_B=$(echo "$DUR_B * $FPS" | bc | cut -d. -f1)

    echo "  Shot A: ${DUR_A}s, motion=$MOTION_A"
    echo "  Shot B: ${DUR_B}s, motion=$MOTION_B, focus=$CROP_FOCUS"

    # Generate Shot A (full frame)
    FILTER_A=$(generate_filter_a $FRAMES_A "$MOTION_A")
    OUTPUT_A="$TEMP_DIR/scene_$(printf '%04d' $scene_num)_a.mp4"

    ffmpeg -y -loop 1 -i "$INPUT_DIR/$scene" \
        -vf "$FILTER_A" \
        -t "$DUR_A" \
        -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p \
        "$OUTPUT_A" 2>/dev/null

    echo "  ✓ Shot A rendered"

    # Generate Shot B (cropped focal point)
    FILTER_B=$(generate_filter_b $FRAMES_B "$MOTION_B" "$CROP_FOCUS")
    OUTPUT_B="$TEMP_DIR/scene_$(printf '%04d' $scene_num)_b.mp4"

    ffmpeg -y -loop 1 -i "$INPUT_DIR/$scene" \
        -vf "$FILTER_B" \
        -t "$DUR_B" \
        -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p \
        "$OUTPUT_B" 2>/dev/null

    echo "  ✓ Shot B rendered"

    # Add to concat list (A then B - hard cut, no transition)
    echo "file '$OUTPUT_A'" >> "$CONCAT_FILE"
    echo "file '$OUTPUT_B'" >> "$CONCAT_FILE"

    # Cycle motion pattern for next scene
    motion_idx=$(( (motion_idx + 1) % ${#MOTIONS_A[@]} ))
    ((scene_num++))
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Concatenating all shots..."

# Concatenate with hard cuts (no transitions)
ffmpeg -y -f concat -safe 0 -i "$CONCAT_FILE" \
    -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p \
    "$OUTPUT_FILE" 2>/dev/null

# Get final video info
DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUTPUT_FILE" 2>/dev/null)
SIZE=$(ls -lh "$OUTPUT_FILE" | awk '{print $5}')
TOTAL_SHOTS=$((SCENE_COUNT * 2))

echo ""
echo "========================================"
echo "✓ COMPLETE"
echo "========================================"
echo "Output: $OUTPUT_FILE"
echo "Duration: ${DURATION}s"
echo "Size: $SIZE"
echo "Scenes: $SCENE_COUNT → $TOTAL_SHOTS visual shots"
echo "Cut frequency: ~$(echo "scale=1; $DURATION / $TOTAL_SHOTS" | bc)s per shot"
echo "========================================"
