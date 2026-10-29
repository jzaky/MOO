import Foundation
import WatchConnectivity
import WatchKit

/// Mirror of `WatchWorkoutState` in apps/mobile/src/features/native/types.ts (JSON).
struct WatchWorkoutState: Codable, Equatable {
  let v: Int
  let workoutId: String
  let workoutName: String
  let exerciseRowId: String?
  let exerciseName: String?
  let setId: String?
  let setLabel: String?
  let weightKg: Double?
  let reps: Double?
  /// Epoch milliseconds.
  let restEndsAt: Double?
  let completedSets: Int
  let totalSets: Int

  var restEndDate: Date? {
    guard let ms = restEndsAt else { return nil }
    return Date(timeIntervalSince1970: ms / 1000)
  }
}

/// Watch side of WatchConnectivity.
///
/// Phone → watch: the latest state arrives as `["state": "<json>"]`, either as
/// the application context (also available at launch) or as an immediate
/// message. `"null"` means no workout is in progress.
/// Watch → phone: `["action": "<json>"]` via `sendMessage` when the phone is
/// reachable, otherwise `transferUserInfo` (queued and delivered later). The
/// phone applies actions idempotently, so a duplicate delivery is harmless.
final class WorkoutSession: NSObject, ObservableObject, WCSessionDelegate {
  @Published private(set) var state: WatchWorkoutState?
  /// The set the user tapped "Complete" for, until the phone confirms with a new state.
  @Published private(set) var pendingSetId: String?

  override init() {
    super.init()
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  func completeSet() {
    guard let s = state, let exerciseRowId = s.exerciseRowId, let setId = s.setId, pendingSetId != setId else { return }
    let action: [String: String] = ["type": "complete_set", "exerciseRowId": exerciseRowId, "setId": setId]
    guard let data = try? JSONSerialization.data(withJSONObject: action),
          let json = String(data: data, encoding: .utf8) else { return }
    pendingSetId = setId
    WKInterfaceDevice.current().play(.success)

    let payload: [String: Any] = ["action": json]
    let session = WCSession.default
    guard session.activationState == .activated else { return }
    if session.isReachable {
      session.sendMessage(payload, replyHandler: nil) { _ in
        // Not delivered right now: queue it so it still reaches the phone.
        session.transferUserInfo(payload)
      }
    } else {
      session.transferUserInfo(payload)
    }
  }

  private func apply(json: String?) {
    guard let json else { return }
    let decoded: WatchWorkoutState?
    if json == "null" {
      decoded = nil
    } else if let data = json.data(using: .utf8), let value = try? JSONDecoder().decode(WatchWorkoutState.self, from: data) {
      decoded = value
    } else {
      return // Unknown payload: keep what we have.
    }
    DispatchQueue.main.async {
      self.state = decoded
      if self.pendingSetId != nil && decoded?.setId != self.pendingSetId {
        self.pendingSetId = nil
      }
    }
  }

  // MARK: - WCSessionDelegate

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    guard activationState == .activated else { return }
    apply(json: session.receivedApplicationContext["state"] as? String)
    if session.isReachable {
      session.sendMessage(["requestState": true], replyHandler: nil, errorHandler: nil)
    }
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    apply(json: applicationContext["state"] as? String)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    apply(json: message["state"] as? String)
  }
}
