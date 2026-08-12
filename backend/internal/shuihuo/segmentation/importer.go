package segmentation

import (
	"regexp"
	"strings"
)

var (
	timecodeLine = regexp.MustCompile(`^\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{1,2}:\d{2}:\d{2}[,.]\d{3}`)
	blankLine    = regexp.MustCompile(`\n[\t ]*\n+`)
)

func ParseImported(text string) []CandidateSegment {
	blocks := blankLine.Split(strings.ReplaceAll(text, "\r\n", "\n"), -1)
	result := make([]CandidateSegment, 0, len(blocks))
	for _, block := range blocks {
		lines := nonEmptyLines(block)
		if len(lines) == 0 {
			continue
		}
		if lines[0] == "WEBVTT" {
			lines = lines[1:]
		}
		if len(lines) > 0 && isNumberLine(lines[0]) {
			lines = lines[1:]
		}
		if len(lines) > 0 && timecodeLine.MatchString(lines[0]) {
			lines = lines[1:]
		}
		if len(lines) > 0 {
			result = append(result, CandidateSegment{Text: strings.Join(lines, "\n")})
		}
	}
	if len(result) == 0 && strings.TrimSpace(text) != "" {
		return []CandidateSegment{{Text: strings.TrimSpace(text)}}
	}
	return result
}
