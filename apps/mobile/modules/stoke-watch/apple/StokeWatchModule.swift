import ExpoModulesCore
import WatchConnectivity

private let onWatchAction = "onWatchAction"

/// Phone side of the Apple Watch companion.
///
/// JS → watch: `sendWorkoutState(json)` stores the JSON string as the session's
/// application context (latest state wins; delivered even if the watch app is
/// not running) and, when the watch is reachable, also sends it immediately.
///
/// watch → JS: the watch sends `["action": "<json>"]` with `sendMessage`
/// (reachable) or `transferUserInfo` (queued). Each one is emitted as an
/// `onWatchAction` event `{ action: "<json>" }`. Actions that arrive before JS
/// subscribes are buffered and flushed on the first listener.
///
/// State travels as a JSON string because application-context dictionaries
/// must be property-list types (no NSNull for JSON nulls).
public final class StokeWatchModule: Module {
  private let bridge = WatchSessionBridge()
  private let lock = NSLock()
  private var observing = false
  private var pending: [String] = []

  public func definition() -> ModuleDefinition {
    Name("StokeWatch")

    Events(onWatchAction)

    // Module DSL closures are stored (escaping), so members need an explicit `self`.
    OnCreate {
      self.bridge.onAction = { [weak self] json in
        self?.deliver(json)
      }
      self.bridge.activate()
    }

    OnStartObserving(onWatchAction) {
      self.lock.lock()
      self.observing = true
      let queued = self.pending
      self.pending.removeAll()
      self.lock.unlock()
      for json in queued {
        self.sendEvent(onWatchAction, ["action": json])
      }
    }

    OnStopObserving(onWatchAction) {
      self.lock.lock()
      self.observing = false
      self.lock.unlock()
    }

    Function("sendWorkoutState") { (json: String) in
      self.bridge.send(stateJSON: json)
    }

    Function("isSupported") { () -> Bool in
      return WCSession.isSupported()
    }
  }

  private func deliver(_ json: String) {
    lock.lock()
    if !observing {
      // Keep only a bounded backlog; the watch re-syncs from the phone's state anyway.
      if pending.count >= 50 { pending.removeFirst() }
      pending.append(json)
      lock.unlock()
      return
    }
    lock.unlock()
    sendEvent(onWatchAction, ["action": json])
  }
}

/// Owns the WCSession delegate (WCSession allows a single delegate per app).
final class WatchSessionBridge: NSObject, WCSessionDelegate {
  var onAction: ((String) -> Void)?
  private let queue = DispatchQueue(label: "com.stoke.watch.session")
  private var lastState: String?

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

  func send(stateJSON: String) {
    queue.async {
      self.lastState = stateJSON
      self.push(stateJSON)
    }
  }

  /// Must run on `queue`.
  private func push(_ json: String) {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
    let payload: [String: Any] = ["state": json, "sentAt": Date().timeIntervalSince1970]
    do {
      try session.updateApplicationContext(payload)
    } catch {
      NSLog("[StokeWatch] updateApplicationContext failed: \(error.localizedDescription)")
    }
    if session.isReachable {
      session.sendMessage(payload, replyHandler: nil) { error in
        NSLog("[StokeWatch] sendMessage failed: \(error.localizedDescription)")
      }
    }
  }

  // MARK: - WCSessionDelegate

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    if let error {
      NSLog("[StokeWatch] activation failed: \(error.localizedDescription)")
      return
    }
    // Re-send whatever JS last asked for once the session is usable.
    queue.async {
      if let state = self.lastState { self.push(state) }
    }
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    // Required on iOS when the user switches watches: activate the session for the new watch.
    session.activate()
  }

  func sessionWatchStateDidChange(_ session: WCSession) {
    queue.async {
      if let state = self.lastState { self.push(state) }
    }
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    queue.async {
      if session.isReachable, let state = self.lastState { self.push(state) }
    }
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    handle(message)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    handle(message)
    replyHandler(["ok": true])
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    handle(userInfo)
  }

  private func handle(_ payload: [String: Any]) {
    if let action = payload["action"] as? String {
      onAction?(action)
    }
    // The watch asks for the current state when it launches.
    if payload["requestState"] != nil {
      queue.async {
        if let state = self.lastState { self.push(state) }
      }
    }
  }
}
