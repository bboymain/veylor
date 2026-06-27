import { env, pipeline } from "@huggingface/transformers";
import {
  FASHION_LABEL_GROUPS,
  type AttributeGroup,
  type FashionAttributes,
} from "./fashion-analysis";

type WorkerRequest = {
  id: string;
  image: string;
};

type WorkerResponse =
  | {
      id: string;
      type: "stage";
      stage: string;
    }
  | {
      id: string;
      type: "result";
      attributes: FashionAttributes;
    }
  | {
      id: string;
      type: "error";
      message: string;
    };

type ClassifierOutput = Array<{ label: string; score: number }>;
type ZeroShotClassifier = (
  image: string,
  labels: string[],
  options?: { hypothesis_template?: string },
) => Promise<ClassifierOutput>;

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = "Xenova/clip-vit-base-patch32";

let classifierPromise: Promise<ZeroShotClassifier> | null = null;

function post(message: WorkerResponse) {
  self.postMessage(message);
}

async function getClassifier(id: string) {
  if (!classifierPromise) {
    post({ id, type: "stage", stage: "Loading fashion model" });
    classifierPromise = pipeline("zero-shot-image-classification", MODEL_ID, {
      device: "wasm",
    }) as Promise<ZeroShotClassifier>;
  }
  return classifierPromise;
}

async function classifyGroup(
  classifier: ZeroShotClassifier,
  image: string,
  labels: string[],
  template = "a fashion photo of {}",
) {
  const results = await classifier(image, labels, { hypothesis_template: template });
  return results.sort((a, b) => b.score - a.score)[0] ?? { label: "", score: 0 };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, image } = event.data;

  try {
    const classifier = await getClassifier(id);
    post({ id, type: "stage", stage: "Preparing image" });

    const attributes = {} as FashionAttributes;
    const groups = Object.entries(FASHION_LABEL_GROUPS) as Array<[AttributeGroup, string[]]>;

    for (const [group, labels] of groups) {
      const stage =
        group === "category"
          ? "Analyzing category"
          : group === "style"
            ? "Detecting style details"
            : "Detecting fashion attributes";
      post({ id, type: "stage", stage });

      const best = await classifyGroup(
        classifier,
        image,
        labels,
        group === "color" || group === "secondaryColor"
          ? "a fashion item that is {}"
          : "a fashion photo showing {}",
      );

      attributes[group] = {
        label: best.label,
        confidence: Math.round(best.score * 100),
      };
    }

    post({ id, type: "stage", stage: "Building search terms" });
    post({ id, type: "result", attributes });
  } catch (error) {
    classifierPromise = null;
    post({
      id,
      type: "error",
      message: error instanceof Error ? error.message : "The local fashion model could not run.",
    });
  }
};
