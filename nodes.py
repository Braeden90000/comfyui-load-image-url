import torch
import numpy as np
from PIL import Image, ImageOps, ImageSequence
import requests
from io import BytesIO
import os
import folder_paths
import hashlib
import node_helpers


class LoadImageFileOrURL:
    """
    A ComfyUI node that loads images from either a local file or a URL.
    Use the source switcher to choose which input to use.
    """

    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]

        return {
            "required": {
                "source": (["file", "url"], {"default": "file"}),
                "image": (sorted(files), {}),
                "url": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "https://example.com/image.png"
                }),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("IMAGE", "MASK")
    FUNCTION = "load_image"
    CATEGORY = "image"

    def load_image(self, source, image, url=""):
        if source == "url":
            if not url or not url.strip():
                raise ValueError("URL is empty. Please enter an image URL.")
            return self.load_from_url(url.strip())
        else:
            return self.load_from_file(image)

    def load_from_file(self, image):
        """Load image from local file - same as default LoadImage"""
        image_path = folder_paths.get_annotated_filepath(image)

        img = node_helpers.pillow(Image.open, image_path)

        output_images = []
        output_masks = []
        w, h = None, None

        excluded_formats = ['MPO']

        for i in ImageSequence.Iterator(img):
            i = node_helpers.pillow(ImageOps.exif_transpose, i)

            if i.mode == 'I':
                i = i.point(lambda i: i * (1 / 255))
            image = i.convert("RGB")

            if len(output_images) == 0:
                w = image.size[0]
                h = image.size[1]

            if image.size[0] != w or image.size[1] != h:
                continue

            image = np.array(image).astype(np.float32) / 255.0
            image = torch.from_numpy(image)[None,]
            if 'A' in i.mode:
                mask = np.array(i.getchannel('A')).astype(np.float32) / 255.0
                mask = 1. - torch.from_numpy(mask)
            else:
                mask = torch.zeros((h, w), dtype=torch.float32, device="cpu")
            output_images.append(image)
            output_masks.append(mask.unsqueeze(0))

        if len(output_images) > 1 and img.format not in excluded_formats:
            output_image = torch.cat(output_images, dim=0)
            output_mask = torch.cat(output_masks, dim=0)
        else:
            output_image = output_images[0]
            output_mask = output_masks[0]

        return (output_image, output_mask)

    def load_from_url(self, url):
        """Download and load image from URL"""
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }

        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()

        img = Image.open(BytesIO(response.content))
        img = ImageOps.exif_transpose(img)

        if img.mode == 'I':
            img = img.point(lambda i: i * (1 / 255))

        if 'A' in img.mode:
            mask = np.array(img.getchannel('A')).astype(np.float32) / 255.0
            mask = 1. - torch.from_numpy(mask)
        else:
            mask = torch.zeros((img.height, img.width), dtype=torch.float32, device="cpu")

        image = img.convert("RGB")
        image = np.array(image).astype(np.float32) / 255.0
        image = torch.from_numpy(image)[None,]

        return (image, mask.unsqueeze(0))

    @classmethod
    def IS_CHANGED(cls, source, image, url=""):
        if source == "url":
            if url and url.strip():
                return hashlib.sha256(url.encode()).hexdigest()
            return ""
        image_path = folder_paths.get_annotated_filepath(image)
        m = hashlib.sha256()
        with open(image_path, 'rb') as f:
            m.update(f.read())
        return m.hexdigest()

    @classmethod
    def VALIDATE_INPUTS(cls, source, image, url=""):
        if source == "url":
            if not url or not url.strip():
                return "Please enter an image URL"
            if not url.startswith(("http://", "https://")):
                return "URL must start with http:// or https://"
            return True
        if not folder_paths.exists_annotated_filepath(image):
            return "Invalid image file: {}".format(image)
        return True


NODE_CLASS_MAPPINGS = {
    "LoadImageFileOrURL": LoadImageFileOrURL
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadImageFileOrURL": "Load Image (File/URL)"
}
