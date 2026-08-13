#!/bin/bash
# Ken Burns Background Video Generator
# Creates 1920x1080 background video with random Ken Burns effects per scene
# Usage: ./create_kenburns_background.sh [input_dir] [output_file] [scene_duration]

set -e

# Configuration
INPUT_DIR="${1:-/Users/ruthlarbie/images}"
OUTPUT_FILE="${2:-/Users/ruthlarbie/background_kenburns.mp4}"
SCENE_DURATION="${3:-6}"  # seconds per scene
FPS=24
WIDTH=1920
HEIGHT=1080
FRAMES=$((SCENE_DURATION * FPS))

# Temp directory for processed scenes
TEMP_DIR="/tmp/kenburns_$$"
mkdir -p "$TEMP_DIR"

# Cleanup on exit
cleanup() {
    echo "Cleaning up temp files..."
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

echo "========================================"
echo "Ken Burns Background Video Generator"
echo "========================================"
echo "Input directory: $INPUT_DIR"
echo "Output file: $OUTPUT_FILE"
echo "Scene duration: ${SCENE_DURATION}s (${FRAMES} frames)"
echo "Resolution: ${WIDTH}x${HEIGHT}"
echo "========================================"

# Find scene images
cd "$INPUT_DIR"
SCENES=$(ls -1 scene_*.png scene_*.jpg 2>/dev/null | sort -V)
SCENE_COUNT=$(echo "$SCENES" | wc -l | tr -d ' ')

if [ "$SCENE_COUNT" -eq 0 ]; then
    echo "ERROR: No scene images found in $INPUT_DIR"
    echo "Expected files like: scene_1.png, scene_2.png, etc."
    exit 1
fi

echo "Found $SCENE_COUNT scenes"
echo ""

# Ken Burns effect functions using zoompan filter
# Each returns the -vf filter string for that effect

# Zoom In: Start at 1.0, zoom to 1.2 (20% zoom), centered
effect_zoom_in() {
    local frames=$1
    # Zoom from 1.0 to 1.2 over duration, staying centered
    # Scale up first to give zoompan room to work
    echo "scale=8000:-1,zoompan=z='min(1.0+on/${frames}*0.2,1.2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}"
}

# Zoom Out: Start at 1.2, zoom to 1.0, centered
effect_zoom_out() {
    local frames=$1
    # Zoom from 1.2 to 1.0 over duration, staying centered
    echo "scale=8000:-1,zoompan=z='1.2-on/${frames}*0.2':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}"
}

# Pan Left: Slight zoom (1.15) with horizontal pan from right to left
effect_pan_left() {
    local frames=$1
    # Start from right side, pan to left while maintaining 1.15 zoom
    echo "scale=8000:-1,zoompan=z='1.15':x='iw/2-(iw/zoom/2)+(iw/zoom*0.1)-(on/${frames})*(iw/zoom*0.2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}"
}

# Pan Right: Slight zoom (1.15) with horizontal pan from left to right
effect_pan_right() {
    local frames=$1
    # Start from left side, pan to right while maintaining 1.15 zoom
    echo "scale=8000:-1,zoompan=z='1.15':x='iw/2-(iw/zoom/2)-(iw/zoom*0.1)+(on/${frames})*(iw/zoom*0.2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}"
}

# Pan Up: Slight zoom (1.15) with vertical pan from bottom to top
effect_pan_up() {
    local frames=$1
    echo "scale=8000:-1,zoompan=z='1.15':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)+(ih/zoom*0.1)-(on/${frames})*(ih/zoom*0.2)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}"
}

# Pan Down: Slight zoom (1.15) with vertical pan from top to bottom
effect_pan_down() {
    local frames=$1
    echo "scale=8000:-1,zoompan=z='1.15':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)-(ih/zoom*0.1)+(on/${frames})*(ih/zoom*0.2)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}"
}

# Array of effect names
EFFECTS=("zoom_in" "zoom_out" "pan_left" "pan_right" "pan_up" "pan_down")

# Process each scene
CONCAT_FILE="$TEMP_DIR/concat.txt"
> "$CONCAT_FILE"

i=1
for scene in $SCENES; do
    echo -n "Processing scene $i/$SCENE_COUNT: $scene ... "

    # Pick random effect
    EFFECT_IDX=$((RANDOM % ${#EFFECTS[@]}))
    EFFECT_NAME="${EFFECTS[$EFFECT_IDX]}"

    # Get the filter for this effect
    case $EFFECT_NAME in
        "zoom_in")
            FILTER=$(effect_zoom_in $FRAMES)
            ;;
        "zoom_out")
            FILTER=$(effect_zoom_out $FRAMES)
            ;;
        "pan_left")
            FILTER=$(effect_pan_left $FRAMES)
            ;;
        "pan_right")
            FILTER=$(effect_pan_right $FRAMES)
            ;;
        "pan_up")
            FILTER=$(effect_pan_up $FRAMES)
            ;;
        "pan_down")
            FILTER=$(effect_pan_down $FRAMES)
            ;;
    esac

    OUTPUT_SCENE="$TEMP_DIR/scene_$(printf '%04d' $i).mp4"

    # Apply Ken Burns effect to this scene
    ffmpeg -y -loop 1 -i "$INPUT_DIR/$scene" \
        -vf "$FILTER" \
        -t $SCENE_DURATION \
        -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p \
        "$OUTPUT_SCENE" 2>/dev/null

    echo "$EFFECT_NAME"

    # Add to concat list
    echo "file '$OUTPUT_SCENE'" >> "$CONCAT_FILE"

    ((i++))
done

echo ""
echo "Concatenating scenes..."

# Concatenate all scenes
ffmpeg -y -f concat -safe 0 -i "$CONCAT_FILE" \
    -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p \
    "$OUTPUT_FILE" 2>/dev/null

# Get final video info
DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUTPUT_FILE" 2>/dev/null)
SIZE=$(ls -lh "$OUTPUT_FILE" | awk '{print $5}')

echo ""
echo "========================================"
echo "Complete!"
echo "========================================"
echo "Output: $OUTPUT_FILE"
echo "Duration: ${DURATION}s"
echo "Size: $SIZE"
echo "Scenes: $SCENE_COUNT"
echo "Effects: Random Ken Burns (zoom/pan)"
echo "========================================"
