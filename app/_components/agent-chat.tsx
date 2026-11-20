"use client";

import { ClientError, type MessagePart } from "eve/client";
import {
  activeTurn,
  activity,
  failure,
  interaction,
  interactions,
  turns,
  type Activity,
} from "eve/events";
import { useEveAgent } from "eve/react";
import {
  AlertCircleIcon,
  BrainIcon,
  MicIcon,
  MicOffIcon,
  PlusIcon,
  SquareIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationTopFade,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputButton,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { cn } from "@/lib/utils";
import { AgentMessage } from "./agent-message";
import { WEB_CHAT_AGENT } from "@/app/eve-agent";

const DEFAULT_AGENT_NAME = "JARVIS";
const AGENT_NAME = WEB_CHAT_AGENT ?? DEFAULT_AGENT_NAME;

interface BrowserSpeechRecognition {
  lang: string;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

export function AgentChat({
  sessionId,
  sessionless = false,
}: {
  readonly sessionId?: string;
  readonly sessionless?: boolean;
}) {
  const [cancellationError, setCancellationError] = useState<string>();
  const [hasInputText, setHasInputText] = useState(false);
  const [draft, setDraft] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [liveVoiceMode, setLiveVoiceMode] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string>();
  const hasSubmittedMessage = useRef(false);
  const liveVoiceModeRef = useRef(false);
  const speakRepliesBeforeLive = useRef<boolean | undefined>(undefined);
  const startVoiceInputRef = useRef<() => void>(() => {});
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const britishVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const hadActiveTurn = useRef(false);
  const spokenMessageIds = useRef(new Set<string>());
  const replaceSessionRoute = (nextSessionId: string) => {
    if (sessionId !== undefined) return;
    // Framework routers (Next.js, TanStack Router) patch window.history; navigating
    // through them would remount this route and detach the active stream.
    History.prototype.replaceState.call(
      window.history,
      window.history.state,
      "",
      `/s/${encodeURIComponent(nextSessionId)}`,
    );
  };
  const agent = useEveAgent({
    agent: WEB_CHAT_AGENT,
    prewarm: hasInputText,
    initialSession:
      sessionId === undefined
        ? undefined
        : {
            sessionId,
            streamIndex: 0,
          },
    resume: sessionId !== undefined,
    onSessionChange(session) {
      if (hasSubmittedMessage.current && session !== undefined) {
        replaceSessionRoute(session.sessionId);
      }
    },
  });

  const isBusy = agent.status === "busy";
  // A turn waiting on a person is open while the store is idle; it still takes steering and Stop.
  const turnOpen = activeTurn(agent.view) !== undefined;
  const isResuming = agent.status === "resuming";
  const isEmpty = agent.messages.length === 0;
  const lastMessage = agent.messages.at(-1);
  const isPendingAssistantShell =
    lastMessage?.role === "assistant" && lastMessage.parts.length === 0;
  const now = activity(agent.view);
  // Show what the agent is doing until its message has something to show, unless it waits on you.
  const showPendingThinking =
    isBusy &&
    now.kind !== "waiting-on-interaction" &&
    (lastMessage?.role !== "assistant" || isPendingAssistantShell);
  const failed =
    isBusy || isResuming ? undefined : failure(agent.view, turns(agent.view).at(-1)?.turnId);
  const turnFailure =
    failed?.code === "MODEL_CALL_FAILED"
      ? "The model is temporarily unavailable. Please try again."
      : failed?.message;
  const errorMessage = cancellationError ?? agent.error?.message ?? turnFailure;
  const hasConversationContent = sessionless || !isEmpty || errorMessage !== undefined;
  const showConversationLayout = isResuming || hasConversationContent;
  const activeSessionId = sessionId ?? agent.session?.sessionId;
  // A session that ended outside eve never settles its requests, so they stay open, yet it
  // accepts no answer. Once the server says so, stop offering them.
  const sessionEnded =
    agent.error instanceof ClientError && agent.error.code === "session_not_active";
  // Answers are accepted while work runs; the server's settlement closes each request.
  const canRespond = (interactionId: string) =>
    !isResuming && !sessionEnded && interaction(agent.view, interactionId)?.status === "open";
  // A tool call can ask several questions at once, and its message part holds only the latest.
  const questionsFor = (callId: string) =>
    interactions(agent.view).filter(
      (input) => input.request.kind === "question" && input.call?.callId === callId,
    );

  const requestCancellation = () => {
    setCancellationError(undefined);
    void agent.cancel().catch((error: unknown) => {
      setCancellationError(toErrorMessage(error));
    });
  };

  const sendText = async (value: string) => {
    const text = value.trim();
    if (text.length === 0 || isResuming) return;

    setHasInputText(false);
    setDraft("");
    setCancellationError(undefined);
    hasSubmittedMessage.current = true;
    if (agent.session !== undefined) replaceSessionRoute(agent.session.sessionId);
    const options = turnOpen ? { turnPolicy: "steer" as const } : undefined;
    await agent.send(text, options);
  };

  const stopLiveVoiceMode = (notice = "Live voice chat ended.") => {
    liveVoiceModeRef.current = false;
    setLiveVoiceMode(false);
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    recognition?.abort();
    setIsListening(false);
    window.speechSynthesis?.cancel();
    const previousSpeakReplies = speakRepliesBeforeLive.current;
    if (previousSpeakReplies !== undefined) {
      setSpeakReplies(previousSpeakReplies);
      speakRepliesBeforeLive.current = undefined;
    }
    setVoiceNotice(notice);
  };

  const resumeLiveListening = () => {
    window.setTimeout(() => {
      if (liveVoiceModeRef.current && recognitionRef.current === null) {
        startVoiceInputRef.current();
      }
    }, 300);
  };

  const startVoiceInput = () => {
    if (recognitionRef.current !== null) {
      recognitionRef.current.stop();
      return;
    }

    const speechWindow = window as Window & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    const SpeechRecognitionClass =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (SpeechRecognitionClass === undefined) {
      setVoiceNotice("Voice input is not available in this browser. Try Chrome or Edge.");
      if (liveVoiceModeRef.current) {
        stopLiveVoiceMode("Live voice is not supported in this browser. Try Chrome or Edge.");
      }
      return;
    }

    window.speechSynthesis?.cancel();
    let heardSpeech = false;
    let recognitionFailed = false;
    const recognition = new SpeechRecognitionClass();
    recognition.lang = navigator.language || "en-IN";
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length }, (_, index) =>
        event.results[index]?.isFinal ? event.results[index]?.[0]?.transcript ?? "" : "",
      )
        .filter(Boolean)
        .join(" ")
        .trim();
      if (transcript.length === 0) return;

      heardSpeech = true;
      if (liveVoiceModeRef.current) {
        recognition.stop();
        const pendingInteraction = interactions(agent.view).find((item) => item.status === "open");
        if (pendingInteraction !== undefined) {
          if (
            pendingInteraction.request.kind === "question" &&
            pendingInteraction.request.allowFreeform === true
          ) {
            setVoiceNotice("Sending your answer to JARVIS…");
            void agent
              .respond([{ interactionId: pendingInteraction.interactionId, text: transcript }])
              .catch(() => {
                setVoiceNotice("JARVIS could not submit that answer. Listening again…");
                resumeLiveListening();
              });
          } else {
            setDraft(transcript);
            setHasInputText(true);
            setVoiceNotice("JARVIS is waiting for you. Use the on-screen choice or approval buttons.");
          }
          return;
        }

        setVoiceNotice("Sending that to JARVIS…");
        void sendText(transcript).catch(() => {
          setVoiceNotice("JARVIS could not complete that turn. Tap the microphone to try again.");
          resumeLiveListening();
        });
        return;
      }

      setDraft((current) => `${current.trim()} ${transcript}`.trim());
      setHasInputText(true);
      setVoiceNotice("Voice text added. Review it in the box, then press Send.");
    };
    recognition.onerror = (event) => {
      recognitionFailed = event.error !== "no-speech";
      if (event.error !== "aborted") {
        if (liveVoiceModeRef.current && event.error === "no-speech") {
          setVoiceNotice("I did not hear anything. Listening again…");
        } else {
          const message = speechRecognitionMessage(event.error);
          if (liveVoiceModeRef.current) stopLiveVoiceMode(message);
          else setVoiceNotice(message);
        }
      }
    };
    recognition.onend = () => {
      const wasCurrentRecognition = recognitionRef.current === recognition;
      if (wasCurrentRecognition) recognitionRef.current = null;
      setIsListening(false);
      if (!wasCurrentRecognition) return;

      if (liveVoiceModeRef.current && !heardSpeech && !recognitionFailed) {
        setVoiceNotice("Listening… pause when you finish; JARVIS will reply aloud.");
        resumeLiveListening();
        return;
      }
      if (!heardSpeech && !recognitionFailed) {
        setVoiceNotice("I did not hear anything. Tap the microphone to try again.");
      }
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    setVoiceNotice(
      liveVoiceModeRef.current
        ? "Listening… pause when you finish; JARVIS will reply aloud. Your browser may send audio to its speech service."
        : "Listening… your browser may send audio to its speech service. The words will appear here for review.",
    );
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      const message = "Could not start the microphone. Check your browser's microphone permission.";
      if (liveVoiceModeRef.current) stopLiveVoiceMode(message);
      else setVoiceNotice(message);
    }
  };

  startVoiceInputRef.current = startVoiceInput;

  useEffect(() => {
    const speechSynthesis = window.speechSynthesis;
    const updateBritishVoice = () => {
      britishVoiceRef.current = selectBritishVoice(speechSynthesis.getVoices());
    };

    updateBritishVoice();
    speechSynthesis.addEventListener("voiceschanged", updateBritishVoice);
    return () => speechSynthesis.removeEventListener("voiceschanged", updateBritishVoice);
  }, []);

  const toggleLiveVoiceMode = () => {
    if (liveVoiceModeRef.current) {
      stopLiveVoiceMode();
      return;
    }

    liveVoiceModeRef.current = true;
    speakRepliesBeforeLive.current = speakReplies;
    setLiveVoiceMode(true);
    setSpeakReplies(true);
    setCancellationError(undefined);
    setVoiceNotice("Live voice is starting. Speak after the microphone begins listening.");
    resumeLiveListening();
  };

  const toggleSpeakReplies = () => {
    if (liveVoiceModeRef.current) return;
    const next = !speakReplies;
    setSpeakReplies(next);
    if (!next) window.speechSynthesis?.cancel();
  };

  useEffect(() => {
    if (isBusy || isResuming) {
      hadActiveTurn.current = true;
      if (liveVoiceModeRef.current) setVoiceNotice("JARVIS is thinking…");
      return;
    }
    if (!hadActiveTurn.current) return;
    hadActiveTurn.current = false;
    if (!speakReplies || agent.status !== "idle") return;
    if (errorMessage !== undefined) {
      if (liveVoiceModeRef.current) {
        setVoiceNotice("JARVIS could not finish that reply. Listening again…");
        resumeLiveListening();
      }
      return;
    }

    const lastAssistantMessage = [...agent.messages].reverse().find((message) => message.role === "assistant");
    if (lastAssistantMessage === undefined || spokenMessageIds.current.has(lastAssistantMessage.id)) {
      if (liveVoiceModeRef.current) resumeLiveListening();
      return;
    }

    const text = toNaturalSpeech(
      lastAssistantMessage.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
    );
    if (text.length === 0 || typeof SpeechSynthesisUtterance === "undefined") {
      if (liveVoiceModeRef.current) {
        setVoiceNotice("This browser cannot speak replies. Listening again…");
        resumeLiveListening();
      }
      return;
    }

    const speech = new SpeechSynthesisUtterance(text);
    const britishVoice =
      britishVoiceRef.current ?? selectBritishVoice(window.speechSynthesis?.getVoices() ?? []);
    if (britishVoice !== null) speech.voice = britishVoice;
    speech.lang = britishVoice?.lang ?? "en-GB";
    speech.rate = 0.98;
    speech.pitch = 1;
    speech.onstart = () => {
      if (liveVoiceModeRef.current) {
        setVoiceNotice("JARVIS is speaking. Tap the microphone to interrupt, or end live voice.");
      }
    };
    speech.onend = () => {
      if (liveVoiceModeRef.current && turnOpen && now.kind === "waiting-on-interaction") {
        setVoiceNotice("JARVIS is waiting for you. Use the on-screen choice or approval buttons.");
      } else if (liveVoiceModeRef.current) {
        setVoiceNotice("Listening… pause when you finish; JARVIS will reply aloud.");
        resumeLiveListening();
      }
    };
    speech.onerror = () => {
      if (liveVoiceModeRef.current) resumeLiveListening();
    };
    window.speechSynthesis?.speak(speech);
    spokenMessageIds.current.add(lastAssistantMessage.id);
  }, [
    agent.messages,
    agent.status,
    errorMessage,
    isBusy,
    isResuming,
    now.kind,
    speakReplies,
    turnOpen,
  ]);

  useEffect(
    () => () => {
      liveVoiceModeRef.current = false;
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
    },
    [],
  );

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if ((text.length === 0 && message.files.length === 0) || isResuming) return;

    if (message.files.length === 0) {
      await sendText(text);
      return;
    }

    setHasInputText(false);
    setDraft("");
    setCancellationError(undefined);
    hasSubmittedMessage.current = true;
    if (agent.session !== undefined) replaceSessionRoute(agent.session.sessionId);
    const options = turnOpen ? { turnPolicy: "steer" as const } : undefined;

    const parts: MessagePart[] = [];
    if (text.length > 0) {
      parts.push({ text, type: "text" });
    }
    for (const file of message.files) {
      parts.push({
        data: file.url,
        filename: file.filename,
        mediaType: file.mediaType,
        type: "file",
      });
    }

    await agent.send(parts, options);
  };

  const composer = (
    <PromptInput onSubmit={handleSubmit}>
      <PromptInputTextarea
        disabled={isResuming}
        className="pr-28 pb-12"
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          setHasInputText(event.currentTarget.value.trim().length > 0);
        }}
        placeholder="Message JARVIS or tap the microphone…"
        value={draft}
      />
      <ComposerAction
        canCancel={turnOpen}
        isListening={isListening}
        isResuming={isResuming}
        liveVoiceMode={liveVoiceMode}
        onToggleListening={startVoiceInput}
        onToggleSpeakReplies={toggleSpeakReplies}
        speakReplies={speakReplies}
        hasInputText={hasInputText}
        onCancel={requestCancellation}
      />
    </PromptInput>
  );

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {showConversationLayout ? (
        <ChatHeader canStartNewChat={activeSessionId !== undefined} />
      ) : null}

      {showConversationLayout ? (
        <Conversation
          className="min-h-0 flex-1"
          initial={sessionId === undefined ? undefined : false}
          resize={activeSessionId === undefined ? "smooth" : "instant"}
          scrollRestorationKey={
            isEmpty || activeSessionId === undefined
              ? undefined
              : `eve:web-chat-scroll:${activeSessionId}`
          }
        >
          <ConversationTopFade className="top-14" />
          <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 pt-20 pb-36 sm:px-6">
            {agent.messages.map((message) =>
              showPendingThinking &&
              isPendingAssistantShell &&
              message.id === lastMessage.id ? null : (
                <AgentMessage
                  canRespond={canRespond}
                  key={message.id}
                  message={message}
                  questionsFor={questionsFor}
                  view={agent.view}
                  onAnswers={async (answers) => {
                    setCancellationError(undefined);
                    await agent.respond(answers).catch((cause: unknown) => {
                      setCancellationError(
                        cause instanceof Error ? cause.message : "Unable to submit the answer.",
                      );
                    });
                  }}
                />
              ),
            )}
            {showPendingThinking ? <PendingActivity activity={now} /> : null}
            {errorMessage ? <ErrorMessage message={errorMessage} /> : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      ) : null}

      <div
        className={cn(
          "mx-auto w-full px-4 sm:px-6",
          showConversationLayout
            ? "fixed bottom-0 left-1/2 z-20 max-w-3xl -translate-x-1/2 bg-gradient-to-t from-background via-background to-transparent pt-4 pb-6"
            : "flex max-w-xl flex-1 flex-col items-center justify-center gap-8 pb-[10vh]",
        )}
      >
        {showConversationLayout ? null : (
          <div className="flex flex-col items-center gap-3 text-center">
            <h1 className="font-medium text-5xl tracking-tighter">{AGENT_NAME}</h1>
          </div>
        )}
        <div className="w-full">
          {voiceNotice ? (
            <p aria-live="polite" className="px-3 pb-2 text-xs text-muted-foreground" role="status">
              {voiceNotice}
            </p>
          ) : null}
          <div className="mb-2 flex justify-end">
            <Button
              aria-pressed={liveVoiceMode}
              disabled={isResuming}
              onClick={toggleLiveVoiceMode}
              size="sm"
              type="button"
              variant={liveVoiceMode ? "secondary" : "outline"}
            >
              {liveVoiceMode ? (
                <MicOffIcon className="size-4" />
              ) : (
                <MicIcon className="size-4" />
              )}
              {liveVoiceMode ? "End live voice" : "Start live voice"}
            </Button>
          </div>
          {composer}
        </div>
      </div>
    </main>
  );
}

function ComposerAction({
  hasInputText,
  canCancel,
  isResuming,
  isListening,
  liveVoiceMode,
  speakReplies,
  onCancel,
  onToggleListening,
  onToggleSpeakReplies,
}: {
  readonly hasInputText: boolean;
  readonly canCancel: boolean;
  readonly isResuming: boolean;
  readonly isListening: boolean;
  readonly liveVoiceMode: boolean;
  readonly speakReplies: boolean;
  readonly onCancel: () => void;
  readonly onToggleListening: () => void;
  readonly onToggleSpeakReplies: () => void;
}) {
  const attachments = usePromptInputAttachments();
  const canSubmit = hasInputText || attachments.files.length > 0;

  return (
    <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1">
      <PromptInputButton
        aria-label={isListening ? "Stop listening" : "Speak a message"}
        disabled={isResuming}
        onClick={onToggleListening}
        title={isListening ? "Stop listening" : "Speak a message"}
        variant={isListening ? "destructive" : "ghost"}
      >
        {isListening ? <MicOffIcon className="size-4" /> : <MicIcon className="size-4" />}
      </PromptInputButton>
      <PromptInputButton
        aria-label={speakReplies ? "Turn off spoken replies" : "Turn on spoken replies"}
        aria-pressed={speakReplies}
        disabled={liveVoiceMode}
        onClick={onToggleSpeakReplies}
        title={
          liveVoiceMode
            ? "Spoken replies are part of live voice chat"
            : speakReplies
              ? "Spoken replies on"
              : "Spoken replies off"
        }
        variant={speakReplies ? "secondary" : "ghost"}
      >
        {speakReplies ? <Volume2Icon className="size-4" /> : <VolumeXIcon className="size-4" />}
      </PromptInputButton>
      {canCancel && !canSubmit ? (
        <PromptInputButton aria-label="Stop" onClick={onCancel} variant="outline">
          <SquareIcon className="size-3 fill-current" />
        </PromptInputButton>
      ) : (
        <PromptInputSubmit className="static" disabled={isResuming} />
      )}
    </div>
  );
}

function speechRecognitionMessage(error: string): string {
  switch (error) {
    case "not-allowed":
      return "Allow microphone access in your browser to use voice input.";
    case "audio-capture":
      return "No microphone was found. Check that one is connected.";
    case "no-speech":
      return "I did not hear anything. Tap the microphone to try again.";
    case "network":
      return "The browser's speech service could not be reached. Check your internet connection.";
    case "service-not-allowed":
      return "The browser's speech service is unavailable for this page.";
    default:
      return "Voice input stopped. Tap the microphone to try again.";
  }
}

function selectBritishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const britishVoices = voices.filter((voice) => /^en[-_]gb(?:[-_]|$)/i.test(voice.lang));
  return (
    britishVoices.find((voice) => /natural|neural/i.test(voice.name)) ??
    britishVoices.find((voice) => /online/i.test(voice.name)) ??
    britishVoices[0] ??
    null
  );
}

function toNaturalSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, " I included a code example on screen. ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gm, "")
    .replace(/^\s*[•▪◦]\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, "")
    .replace(/\|/g, ", ")
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/__([\s\S]*?)__/g, "$1")
    .replace(/\*([\s\S]*?)\*/g, "$1")
    .replace(/_([\s\S]*?)_/g, "$1")
    .replace(/~~([\s\S]*?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/:(?=\s|$)/g, ",")
    .replace(/\s*;\s*/g, ", ")
    .replace(/\be\.g\.\s*/gi, "for example ")
    .replace(/\bi\.e\.\s*/gi, "that is ")
    .replace(/\betc\.?\b/gi, "and so on")
    .replace(/&/g, " and ")
    .replace(/[\[\]{}*_~`#]/g, "")
    .replace(/[—–]/g, ", ")
    .replace(/\.{2,}/g, ".")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, ". ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/([,.!?])(?:\s*[,;])+\s*/g, "$1 ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function ErrorMessage({ message }: { readonly message: string }) {
  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent>
        <div
          className="flex w-full items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm"
          role="alert"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">Request failed</p>
            <p className="mt-0.5 text-muted-foreground">{message}</p>
          </div>
        </div>
      </MessageContent>
    </Message>
  );
}

function ChatHeader({ canStartNewChat }: { readonly canStartNewChat: boolean }) {
  return (
    <header className="pointer-events-none fixed top-0 right-0 left-0 z-20 h-14">
      <div className="relative mx-auto flex h-full w-full max-w-3xl items-center justify-center bg-background px-24">
        <span className="truncate text-muted-foreground text-sm">{AGENT_NAME}</span>
        {canStartNewChat ? (
          <Button
            aria-label="Start a new chat"
            className="pointer-events-auto fixed top-3 right-6 pr-4"
            onClick={() => window.location.assign("/s")}
            size="sm"
            type="button"
            variant="ghost"
          >
            <PlusIcon className="size-4" />
            <span className="hidden font-normal text-sm sm:inline">New chat</span>
          </Button>
        ) : null}
      </div>
    </header>
  );
}

function PendingActivity({ activity }: { readonly activity: Activity }) {
  return (
    <Message aria-live="polite" from="assistant">
      <MessageContent>
        <Trace>
          <TraceLine status="running">
            <TraceIcon>
              <BrainIcon />
            </TraceIcon>
            <TraceTitle>{activityLabel(activity)}</TraceTitle>
          </TraceLine>
        </Trace>
      </MessageContent>
    </Message>
  );
}

function activityLabel(activity: Activity): string {
  switch (activity.kind) {
    case "calling":
      return activity.names.join(", ");
    case "waiting-on-tasks":
      return `Waiting on ${activity.tasks.map((task) => task.name).join(", ")}`;
    case "compacting":
      return "Compacting the conversation";
    default:
      return "Thinking";
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to cancel the response.";
}
