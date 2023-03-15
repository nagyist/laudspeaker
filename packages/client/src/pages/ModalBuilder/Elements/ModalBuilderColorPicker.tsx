import React, { FC, useState } from "react";
import { SketchPicker } from "react-color";

interface ModalBuilderColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  className?: string;
}

const validHexChars = "1234567890ABCDEFabcdef";

const ModalBuilderColorPicker: FC<ModalBuilderColorPickerProps> = ({
  color,
  onChange,
  className,
}) => {
  const [isColorPickerModalOpen, setIsColorPickerModalOpen] = useState(false);

  return (
    <div className="relative">
      <input
        type="text"
        className={`!m-0 max-w-[70px] max-h-[26px] text-[12px] rounded-md bg-transparent border-white focus:border-white focus:ring-transparent p-[4px] pl-[20px] ${
          className ? className : ""
        }`}
        value={color}
        onChange={(e) =>
          onChange(
            "#" +
              e.target.value
                .replaceAll("#", "")
                .split("")
                .filter((char) => validHexChars.includes(char))
                .join("")
                .substring(0, 6)
          )
        }
      />
      <div
        className="absolute w-[15px] h-[15px] top-1/2 left-[4px] -translate-y-1/2 rounded cursor-pointer"
        style={{ backgroundColor: color }}
        onClick={() => setIsColorPickerModalOpen(true)}
      />
      {isColorPickerModalOpen && (
        <div className="absolute select-none left-[-100%] z-[9999999] bg-white text-black">
          <div
            className="flex justify-end items-center px-[10px] cursor-pointer"
            onClick={() => setIsColorPickerModalOpen(false)}
          >
            X
          </div>
          <SketchPicker
            color={color}
            onChange={(newColor) => onChange(newColor.hex)}
          />
        </div>
      )}
    </div>
  );
};

export default ModalBuilderColorPicker;
