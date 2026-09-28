import Foundation
import AVFoundation
import Vision

let asset = AVURLAsset(url: URL(string: CommandLine.arguments[1])!)
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero
let end = Double(CommandLine.arguments[2])!
let step = Double(CommandLine.arguments[3])!
var timestamp = CommandLine.arguments.count > 4 ? Double(CommandLine.arguments[4])! : 0.0
while timestamp < end {
    let time = timestamp
    autoreleasepool {
        do {
            let frame = try generator.copyCGImage(at: CMTime(seconds: time, preferredTimescale: 600), actualTime: nil)
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.recognitionLanguages = ["zh-Hans", "en-US"]
            request.usesLanguageCorrection = true
            try VNImageRequestHandler(cgImage: frame).perform([request])
            let lines = (request.results ?? []).sorted { $0.boundingBox.midY > $1.boundingBox.midY }.compactMap { observation -> [String: Any]? in
                guard let candidate = observation.topCandidates(1).first else { return nil }
                return ["text": candidate.string, "confidence": candidate.confidence,
                        "x": observation.boundingBox.minX, "y": observation.boundingBox.minY,
                        "height": observation.boundingBox.height]
            }
            let json = try JSONSerialization.data(withJSONObject: ["seconds": time, "lines": lines])
            FileHandle.standardOutput.write(json)
            FileHandle.standardOutput.write(Data([10]))
        } catch {
            let json = try! JSONSerialization.data(withJSONObject: ["seconds": time, "error": "FRAME_READ_FAILED"])
            FileHandle.standardOutput.write(json)
            FileHandle.standardOutput.write(Data([10]))
        }
    }
    timestamp += step
}
