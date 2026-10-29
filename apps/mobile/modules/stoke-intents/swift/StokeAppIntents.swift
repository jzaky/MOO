// Copied into the main app target by modules/stoke-intents/app.plugin.js on prebuild.
// Siri / Shortcuts / Spotlight entry points. Every intent foregrounds the app and
// hands off to a deep link, so all app logic stays in JavaScript
// (src/app/+native-intent.tsx resolves the links).

import AppIntents
import UIKit

private let urlQueryAllowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")

@MainActor
private func openStokeURL(_ string: String) async {
  guard let url = URL(string: string) else { return }
  _ = await UIApplication.shared.open(url)
}

@available(iOS 16.0, *)
struct LogFoodInStokeIntent: AppIntent {
  static let title: LocalizedStringResource = "Log food in Stoke"
  static let description = IntentDescription("Describe what you ate. Stoke opens with it understood and ready to confirm.")
  static let openAppWhenRun: Bool = true

  @Parameter(title: "What you ate")
  var text: String

  static var parameterSummary: some ParameterSummary {
    Summary("Log \(\.$text) in Stoke")
  }

  @MainActor
  func perform() async throws -> some IntentResult {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let encoded = trimmed.addingPercentEncoding(withAllowedCharacters: urlQueryAllowed) ?? ""
    await openStokeURL(encoded.isEmpty ? "stoke://log" : "stoke://log?text=\(encoded)")
    return .result()
  }
}

@available(iOS 16.0, *)
struct StartWorkoutInStokeIntent: AppIntent {
  static let title: LocalizedStringResource = "Start a workout in Stoke"
  static let description = IntentDescription("Opens Train, or resumes the workout in progress.")
  static let openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    await openStokeURL("stoke://workout/start")
    return .result()
  }
}

@available(iOS 16.0, *)
struct StokeAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: LogFoodInStokeIntent(),
      phrases: ["Log food in \(.applicationName)", "Log a meal in \(.applicationName)"],
      shortTitle: "Log food",
      systemImageName: "fork.knife"
    )
    AppShortcut(
      intent: StartWorkoutInStokeIntent(),
      phrases: ["Start a workout in \(.applicationName)", "Start training in \(.applicationName)"],
      shortTitle: "Start workout",
      systemImageName: "figure.strengthtraining.traditional"
    )
  }
}
