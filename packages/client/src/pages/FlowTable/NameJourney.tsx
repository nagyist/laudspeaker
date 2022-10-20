import { useState } from "react";
import { Box, Typography, Grid, FormControl, Tooltip } from "@mui/material";
import Card from "components/Cards/Card";
import { GenericButton, Input } from "components/Elements";
import { useNavigate } from "react-router-dom";

export interface INameSegmentForm {
  name: string;
  isPrimary: boolean;
}

const segmentTypeStyle = {
  border: "1px solid #D1D5DB",
  borderRadius: "6px",
  boxShadow: "0px 1px 2px rgba(0, 0, 0, 0.05)",
  width: "234px",
  marginTop: "20px",
  padding: "15px",
};

interface INameSegment {
  onSubmit?: (e: any) => void;
  isPrimary: boolean;
}

const NameJourney = ({ onSubmit, isPrimary }: INameSegment) => {
  // A Segment initally has three Properties:
  //      1. Dynamic: whether new customers are added
  //         after a workflow is live
  //      2. Name, the name of the segment
  //      3. Description, the segment description
  const [segmentForm, setSegmentForm] = useState<INameSegmentForm>({
    name: "",
    isPrimary: isPrimary,
  });
  const navigate = useNavigate();

  // Handling Name and Description Fields
  const handleSegmentFormChange = (e: any) => {
    if (e.target.name === "name") {
      setSegmentForm({ ...segmentForm, name: e.target.value });
    }
  };

  // Pushing state back up to the flow builder
  const handleSubmit: any = async (e: any) => {
    const navigationLink = "/flow/" + segmentForm.name;
    navigate(navigationLink);
    e.preventDefault();
    if (onSubmit) {
      onSubmit(segmentForm);
    }
  };

  return (
    <div>
      <div className="items-start flex justify-center pt-[18px] mb-[50px]">
        <div className="w-full">
          <h3 className="font-bold text-[25px] font-[Poppins] text-[#28282E] leading-[38px]">
            Name your Journey
          </h3>
          <form>
            <Input
              isRequired
              value={segmentForm.name}
              placeholder={"Enter name"}
              name="name"
              id="name"
              className="w-full p-[16px] bg-white border-[1px] border-[#D1D5DB] font-[Inter] text-[16px]"
              onChange={handleSegmentFormChange}
            />
          </form>
          <div className="flex justify-end mt-[10px]">
            <GenericButton
              onClick={handleSubmit}
              style={{
                maxWidth: "200px",
                "background-image":
                  "linear-gradient(to right, #6BCDB5 , #307179, #122F5C)",
              }}
            >
              Create
            </GenericButton>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NameJourney;
