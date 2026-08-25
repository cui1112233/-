import AppKit
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    fputs("Usage: generate-app-icon.swift <source-png> <output-png>\n", stderr)
    exit(64)
}

let sourceURL = URL(fileURLWithPath: arguments[1])
let outputURL = URL(fileURLWithPath: arguments[2])
guard let source = NSImage(contentsOf: sourceURL) else {
    fputs("Cannot read source image: \(sourceURL.path)\n", stderr)
    exit(1)
}

let canvasSize = CGSize(width: 1024, height: 1024)
guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: Int(canvasSize.width),
    pixelsHigh: Int(canvasSize.height),
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
) else {
    fputs("Cannot create output bitmap\n", stderr)
    exit(1)
}

NSGraphicsContext.saveGraphicsState()
guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fputs("Cannot create drawing context\n", stderr)
    exit(1)
}
NSGraphicsContext.current = context
NSColor.white.setFill()
NSBezierPath(rect: NSRect(origin: .zero, size: canvasSize)).fill()

let sourceSize = source.size
let maxSize = CGSize(width: 820, height: 520)
let scale = min(maxSize.width / sourceSize.width, maxSize.height / sourceSize.height)
let drawSize = CGSize(width: sourceSize.width * scale, height: sourceSize.height * scale)
let drawRect = NSRect(
    x: (canvasSize.width - drawSize.width) / 2,
    y: (canvasSize.height - drawSize.height) / 2,
    width: drawSize.width,
    height: drawSize.height
)
source.draw(in: drawRect, from: NSRect(origin: .zero, size: sourceSize), operation: .sourceOver, fraction: 1)
NSGraphicsContext.restoreGraphicsState()

guard let pngData = bitmap.representation(using: .png, properties: [:]) else {
    fputs("Cannot encode output PNG\n", stderr)
    exit(1)
}
try pngData.write(to: outputURL)
